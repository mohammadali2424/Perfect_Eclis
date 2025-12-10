import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { hasBoardableVehicleHere, getVehicleLoad } from "./vehicle-helpers";

/** گرفتن کاراکتر از روی tg_id */
async function getCharacterByTg(ctx: MyContext) {
  const { supabase } = ctx.services;
  if (!ctx.from) {
    return { char: null as any, errorText: "نتوانستم هویتت را تشخیص بدهم." };
  }

  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", ctx.from.id)
    .maybeSingle();

  if (error) {
    console.error("getCharacterByTg error:", error);
    return {
      char: null as any,
      errorText: "در خواندن پروندهٔ اکلیسی‌ات مشکلی پیش آمد.",
    };
  }

  if (!data) {
    return {
      char: null as any,
      errorText:
        "هنوز در اکلیس ثبت نشده‌ای.\nاز دستور «ثبت من» در پیوی استفاده کن.",
    };
  }

  return { char: data, errorText: null };
}

/** گرفتن وسیله از روی id */
async function getVehicleById(ctx: MyContext, vehicleId: number) {
  const { supabase } = ctx.services;
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, title, owner_char_id, capacity, current_region_id, current_spot_id")
    .eq("id", vehicleId)
    .maybeSingle();

  if (error) {
    console.error("getVehicleById error:", error);
    return { vehicle: null, errorText: "در خواندن وسیله مشکلی پیش آمد." };
  }

  return { vehicle: data, errorText: null };
}

/** آپدیت لوکیشن وسیله */
async function updateVehicleLocation(
  ctx: MyContext,
  vehicleId: number,
  regionId: number | null,
  spotId: number | null
) {
  const { supabase } = ctx.services;
  const { error } = await supabase
    .from("vehicles")
    .update({
      current_region_id: regionId,
      current_spot_id: spotId,
    })
    .eq("id", vehicleId);

  if (error) {
    console.error("updateVehicleLocation error:", error);
  }
}

/** ثبت حرکت وسیله در vehicle_moves */
async function logVehicleMove(
  ctx: MyContext,
  vehicleId: number,
  fromSpotId: number | null,
  toSpotId: number | null,
  mode: "drive" | "tow" | "other"
) {
  const { supabase } = ctx.services;

  const { error } = await supabase.from("vehicle_moves").insert({
    vehicle_id: vehicleId,
    from_spot_id: fromSpotId,
    to_spot_id: toSpotId,
    mode,
  });

  if (error) {
    console.error("logVehicleMove error:", error);
  }
}

/** برای بعد، اگر خواستی از روی زمان سوخت کم کنی */
function computeFuelUsagePercent(driveSeconds: number): number {
  if (driveSeconds <= 0) return 0;
  return driveSeconds / 120; // هر ۱٪ = ۲ دقیقه
}

/** تعداد راننده و مسافرهای یک وسیله */
async function getVehiclePassengerCount(ctx: MyContext, vehicleId: number) {
  const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicleId);
  const driverCount = driverId ? 1 : 0;
  const passengerCount = passengerIds.length;
  return { driverCount, passengerCount, total: driverCount + passengerCount };
}

/** آیا این کاراکتر الان مسافر جایی هست؟ */
async function isCharacterPassenger(
  ctx: MyContext,
  charId: number
): Promise<boolean> {
  const { supabase } = ctx.services;
  const { data, error } = await supabase
    .from("vehicle_passengers")
    .select("id")
    .eq("character_id", charId)
    .maybeSingle();

  if (error) {
    console.error("isCharacterPassenger error:", error);
    return false;
  }

  return !!data;
}

/** حذف مسافر از همهٔ وسیله‌ها (فقط از جدول passenger) */
async function removePassengerFromAllVehicles(
  ctx: MyContext,
  charId: number
): Promise<void> {
  const { supabase } = ctx.services;

  const { error } = await supabase
    .from("vehicle_passengers")
    .delete()
    .eq("character_id", charId);

  if (error) {
    console.error("removePassengerFromAllVehicles error:", error);
  }
}

/** افزودن یک مسافر به وسیله + ست کردن riding_vehicle_id */
async function addPassengerToVehicle(
  ctx: MyContext,
  vehicleId: number,
  charId: number
): Promise<{ ok: boolean; errorText?: string }> {
  const { supabase } = ctx.services;

  const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicleId);

  const { data: veh, error: vehError } = await supabase
    .from("vehicles")
    .select("capacity")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vehError || !veh) {
    console.error("addPassengerToVehicle get vehicle error:", vehError);
    return { ok: false, errorText: "نتوانستم وسیله را پیدا کنم." };
  }

  const cap = (veh as any).capacity ?? 1;
  const usedSeats = (driverId ? 1 : 0) + passengerIds.length;
  if (usedSeats >= cap) {
    return { ok: false, errorText: "این وسیله دیگر جایی برای مسافر ندارد." };
  }

  // از همه‌ی وسیله‌ها به عنوان مسافر حذفش می‌کنیم
  await removePassengerFromAllVehicles(ctx, charId);

  const { error } = await supabase.from("vehicle_passengers").insert({
    vehicle_id: vehicleId,
    character_id: charId,
  });

  if (error) {
    console.error("addPassengerToVehicle insert error:", error);
    return { ok: false, errorText: "در ثبت مسافر جدید مشکلی پیش آمد." };
  }

  // حالا riding_vehicle_id را هم ست می‌کنیم
  const { error: updErr } = await supabase
    .from("characters")
    .update({ riding_vehicle_id: vehicleId })
    .eq("id", charId);

  if (updErr) {
    console.error("addPassengerToVehicle set riding_vehicle_id error:", updErr);
    return {
      ok: false,
      errorText: "مسافر ثبت شد اما در به‌روزرسانی وضعیتش مشکل پیش آمد.",
    };
  }

  return { ok: true };
}

/** ارسال/آپدیت منوی حمل‌ونقل/ماشین/مسافر با پاک‌کردن منوی قبلی */
async function sendVehicleScreen(
  ctx: MyContext,
  text: string,
  keyboard: InlineKeyboard
) {
  const lastId = (ctx.session as any).ui_last_menu_id as
    | number
    | undefined;

  if (lastId && ctx.chat?.type === "private") {
    try {
      await ctx.api.deleteMessage(ctx.chat.id, lastId);
    } catch {
      // مهم نیست
    }
  }

  const msg = await ctx.reply(text, { reply_markup: keyboard });

  if (ctx.chat?.type === "private") {
    (ctx.session as any).ui_last_menu_id = msg.message_id;
  }
}

/** منوی کلی حمل‌ونقل */
export async function showTransportMenu(ctx: MyContext) {
  const { supabase } = ctx.services;
  const { char, errorText } = await getCharacterByTg(ctx);

  if (!char) {
    await ctx.reply(errorText ?? "پرونده‌ات را پیدا نکردم.");
    return;
  }

  const lines: string[] = [];
  lines.push("🛰 پنل حمل‌ونقل اکلیس");
  lines.push("");

  const { data: vehicles, error: vehErr } = await supabase
    .from("vehicles")
    .select("id")
    .eq("owner_char_id", char.id);

  if (vehErr) console.error("showTransportMenu vehicles error:", vehErr);

  const hasOwnedVehicles = !!vehicles && vehicles.length > 0;

  let canBoard = false;
  let hasFlux = false;

  if (char.current_region_id && char.current_spot_id) {
    canBoard = await hasBoardableVehicleHere(
      ctx,
      char.current_region_id,
      char.current_spot_id
    );

    try {
      const { data: wells, error: wellErr } = await supabase
        .from("flux_wells")
        .select("id")
        .eq("region_id", char.current_region_id)
        .eq("spot_id", char.current_spot_id);

      if (wellErr) {
        // اگر جدول flux_wells نباشد، فقط نادیده می‌گیریم
        if ((wellErr as any).code !== "PGRST205") {
          console.error("showTransportMenu wells error:", wellErr);
        }
      } else {
        hasFlux = !!wells && wells.length > 0;
      }
    } catch (e) {
      console.error("showTransportMenu wells unexpected error:", e);
    }
  }

  const kb = new InlineKeyboard();

  if (hasOwnedVehicles) {
    kb.text("🚗 ماشین‌های من", "veh:my").row();
    lines.push("• ماشین‌هایت را از اینجا مدیریت می‌کنی.");
  }

  if (canBoard) {
    kb.text("🚕 سوار می‌شوم", "ride:menu").row();
    lines.push("• می‌توانی مسافر یکی از وسیله‌های حاضر در این نقطه شوی.");
  }

  if (hasFlux) {
    kb.text("⛽ سوخت‌گیری", "flux:fuel").row();
    lines.push("• در این نقطه چاه فلوکس فعال است.");
  }

  kb.text("⬅️ بازگشت به منوی اصلی", "ui:home");

  if (!hasOwnedVehicles && !canBoard && !hasFlux) {
    lines.push(
      "فعلاً نه وسیله‌ای برای خودت داری، نه چیزی این اطراف برای سوار شدن، نه چاه فلوکس."
    );
    lines.push(
      "وقتی شاپ برایت وسیله ثبت کند یا به نقطهٔ مناسب برسی، این‌جا زنده می‌شود."
    );
  }

  await sendVehicleScreen(ctx, lines.join("\n"), kb);
}

/** منوی «ماشین‌های من» */
async function showMyVehiclesMenu(ctx: MyContext) {
  const { supabase } = ctx.services;
  const { char, errorText } = await getCharacterByTg(ctx);

  if (!char) {
    await ctx.reply(errorText ?? "پرونده‌ات را پیدا نکردم.");
    return;
  }

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, title, capacity")
    .eq("owner_char_id", char.id);

  if (error) {
    console.error("showMyVehiclesMenu vehicles error:", error);
    await ctx.reply("در خواندن لیست وسیله‌ها مشکلی پیش آمد.");
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    await ctx.reply(
      "در دفتر اکلیس برایت وسیلهٔ نقلیه‌ای ثبت نشده.\nوقتی در شاپ وسیله بخری، از اینجا می‌توانی مدیریتشان کنی."
    );
    return;
  }

  const kb = new InlineKeyboard();
  for (const v of vehicles) {
    const label = `${(v as any).title ?? "وسیله"} (#${v.id})`;
    kb.text(label, `veh:open:${v.id}`).row();
  }
  kb.text("⬅️ بازگشت به حمل‌ونقل", "trans:menu");

  await sendVehicleScreen(ctx, "🚗 ماشین‌ها و وسیله‌های تو:", kb);
}

/** نمایش صفحهٔ یک وسیلهٔ خاص برای صاحبش */
async function showVehicleDetail(ctx: MyContext, vehicleId: number) {
  const { supabase } = ctx.services;
  const { char, errorText } = await getCharacterByTg(ctx);

  if (!char) {
    await ctx.reply(errorText ?? "پرونده‌ات را پیدا نکردم.");
    return;
  }

  const { vehicle, errorText: err2 } = await getVehicleById(ctx, vehicleId);
  if (!vehicle) {
    await ctx.reply(err2 ?? "وسیله‌ای با این مشخصات پیدا نشد.");
    return;
  }

  if ((vehicle as any).owner_char_id !== char.id) {
    await ctx.reply("این وسیله متعلق به تو نیست.");
    return;
  }

  const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicleId);
  const cap = (vehicle as any).capacity ?? 1;
  const used = (driverId ? 1 : 0) + passengerIds.length;
  const free = cap - used;

  const lines: string[] = [];
  lines.push(`🚗 ${(vehicle as any).title ?? "وسیلهٔ ناشناس"} (#${vehicle.id})`);
  lines.push("");
  lines.push(`ظرفیت کلی: ${cap}`);
  lines.push(`صندلی‌های پر: ${used}`);
  lines.push(`صندلی‌های خالی: ${free < 0 ? 0 : free}`);
  lines.push("");
  if (driverId) lines.push("وضعیت: در حال رانندگی");
  else lines.push("وضعیت: پارک شده");

  const kb = new InlineKeyboard();

  if (!driverId) {
    kb.text("🕹 سوار شوم (راننده)", `veh:drive:${vehicle.id}`).row();
  } else if (driverId === char.id) {
    kb.text("🕹 پیاده شوم", `veh:leave:${vehicle.id}`).row();
  }

  kb.text("🚕 مسافران", `veh:passengers:${vehicle.id}`).row();
  kb.text("⬅️ بازگشت به ماشین‌هایم", "veh:my");

  await sendVehicleScreen(ctx, lines.join("\n"), kb);
}

/** نمایش لیست مسافران یک وسیله */
async function showVehiclePassengers(ctx: MyContext, vehicleId: number) {
  const { supabase } = ctx.services;
  const { char, errorText } = await getCharacterByTg(ctx);
  if (!char) {
    await ctx.reply(errorText ?? "پرونده‌ات را پیدا نکردم.");
    return;
  }

  const { vehicle } = await getVehicleById(ctx, vehicleId);
  if (!vehicle || (vehicle as any).owner_char_id !== char.id) {
    await ctx.reply("به این وسیله دسترسی نداری.");
    return;
  }

  const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicleId);
  const lines: string[] = [];
  lines.push(
    `🚕 مسافران ${(vehicle as any).title ?? "وسیله"} (#${vehicle.id})`
  );
  lines.push("");

  if (!driverId && passengerIds.length === 0) {
    lines.push("هیچ‌کس داخل این وسیله نیست.");
  } else {
    if (driverId) {
      const { data: driver, error: err1 } = await supabase
        .from("characters")
        .select("char_name")
        .eq("id", driverId)
        .maybeSingle();
      if (!err1 && driver) lines.push(`🕹 راننده: ${driver.char_name}`);
    }

    if (passengerIds.length > 0) {
      lines.push("");
      lines.push("🚕 مسافران:");
      const { data: chars, error: err2 } = await supabase
        .from("characters")
        .select("id, char_name")
        .in("id", passengerIds);
      if (!err2 && chars) {
        for (const c of chars) lines.push(`• ${c.char_name}`);
      }
    }
  }

  const kb = new InlineKeyboard()
    .text("⬅️ بازگشت به وسیله", `veh:open:${vehicle.id}`)
    .row()
    .text("⬅️ بازگشت به ماشین‌هایم", "veh:my");

  await sendVehicleScreen(ctx, lines.join("\n"), kb);
}

/** راننده شدن روی یک وسیله */
async function handleDriveVehicle(ctx: MyContext, vehicleId: number) {
  const { supabase } = ctx.services;
  const { char, errorText } = await getCharacterByTg(ctx);
  if (!char) {
    await ctx.reply(errorText ?? "پرونده‌ات را پیدا نکردم.");
    return;
  }

  const { vehicle, errorText: err2 } = await getVehicleById(ctx, vehicleId);
  if (!vehicle) {
    await ctx.reply(err2 ?? "وسیله‌ای با این مشخصات پیدا نشد.");
    return;
  }

  if ((vehicle as any).owner_char_id !== char.id) {
    await ctx.reply("این وسیله متعلق به تو نیست.");
    return;
  }

  // باید در همان نقطه‌ای باشی که وسیله پارک شده
  if (
    !char.current_region_id ||
    !char.current_spot_id ||
    char.current_region_id !== (vehicle as any).current_region_id ||
    char.current_spot_id !== (vehicle as any).current_spot_id
  ) {
    await ctx.reply("برای راننده شدن باید کنار همان وسیله باشی.");
    return;
  }

  // اگر قبلاً سوار وسیله‌ی دیگری بودی، اول پیاده‌ات می‌کنیم
  if (char.riding_vehicle_id && char.riding_vehicle_id !== vehicleId) {
    const { error: clearErr } = await supabase
      .from("characters")
      .update({ riding_vehicle_id: null })
      .eq("id", char.id);
    if (clearErr) {
      console.error("handleDriveVehicle clear previous mount error:", clearErr);
    }
  }

  const { error } = await supabase
    .from("characters")
    .update({ riding_vehicle_id: vehicleId })
    .eq("id", char.id);

  if (error) {
    console.error("handleDriveVehicle update error:", error);
    await ctx.reply("در سوار شدن مشکلی پیش آمد.");
    return;
  }

  await ctx.reply(`🕹 تو حالا رانندهٔ ${(vehicle as any).title ?? "وسیله"} شدی.`);
}

/** پیاده شدن راننده از وسیله */
async function handleLeaveVehicle(ctx: MyContext, vehicleId: number) {
  const { supabase } = ctx.services;
  const { char, errorText } = await getCharacterByTg(ctx);
  if (!char) {
    await ctx.reply(errorText ?? "پرونده‌ات را پیدا نکردم.");
    return;
  }

  const { vehicle, errorText: err2 } = await getVehicleById(ctx, vehicleId);
  if (!vehicle) {
    await ctx.reply(err2 ?? "وسیله‌ای با این مشخصات پیدا نشد.");
    return;
  }

  if (char.riding_vehicle_id !== vehicleId) {
    await ctx.reply("الان روی این وسیله سوار نیستی.");
    return;
  }

  const { error } = await supabase
    .from("characters")
    .update({ riding_vehicle_id: null })
    .eq("id", char.id);

  if (error) {
    console.error("handleLeaveVehicle update error:", error);
    await ctx.reply("در پیاده شدن مشکلی پیش آمد.");
    return;
  }

  await ctx.reply(
    `🕹 از ${(vehicle as any).title ?? "وسیله"} پیاده شدی. وسیله در همین نقطه می‌ماند.`
  );
}

/** منوی مسافر شدن: لیست ماشین‌های حاضر در همین نقطه */
async function showRideMenu(ctx: MyContext) {
  const { supabase } = ctx.services;
  const { char, errorText } = await getCharacterByTg(ctx);
  if (!char) {
    await ctx.reply(errorText ?? "پرونده‌ات را پیدا نکردم.");
    return;
  }

  // اگر خودش راننده است، اجازه مسافر شدن نمی‌دهیم
  if (char.riding_vehicle_id) {
    const { data: veh, error: vehErr } = await supabase
      .from("vehicles")
      .select("id, title, owner_char_id")
      .eq("id", char.riding_vehicle_id)
      .maybeSingle();

    if (!vehErr && veh) {
      if ((veh as any).owner_char_id === char.id) {
        await ctx.reply(
          "الان خودت رانندهٔ یک وسیله هستی.\nبرای مسافر شدن باید اول از وسیله‌ات پیاده شوی."
        );
        return;
      } else {
        await ctx.reply(
          "الان خودت به عنوان مسافر داخل یک وسیله‌ای.\nاگر بخواهی پیاده شوی باید به ناظرها اطلاع بدهی (فعلاً)."
        );
        return;
      }
    }
  }

  const alreadyPassenger = await isCharacterPassenger(ctx, char.id);
  if (alreadyPassenger) {
    await ctx.reply(
      "الان به عنوان مسافر داخل یک وسیله‌ای.\nاگر بخواهی پیاده شوی باید به ناظرها اطلاع بدهی (فعلاً)."
    );
    return;
  }

  if (!char.current_region_id || !char.current_spot_id) {
    await ctx.reply(
      "مکان فعلی‌ات مشخص نیست.\nباید اول توسط ارباب در یک Region ثبت شوی."
    );
    return;
  }

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, title, capacity, current_region_id, current_spot_id")
    .eq("current_region_id", char.current_region_id)
    .eq("current_spot_id", char.current_spot_id);

  if (error) {
    console.error("showRideMenu vehicles error:", error);
    await ctx.reply("در خواندن وسیله‌های این نقطه مشکلی پیش آمد.");
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    const kb = new InlineKeyboard().text(
      "⬅️ بازگشت به حمل‌ونقل",
      "trans:menu"
    );
    await sendVehicleScreen(
      ctx,
      "در این نقطه وسیله‌ای برای سوار شدن پیدا نکردم.",
      kb
    );
    return;
  }

  const kb = new InlineKeyboard();
  const lines: string[] = [];
  lines.push("🚕 کدام وسیله را می‌خواهی سوار شوی؟");
  lines.push("");

  let anyBoardable = false;

  for (const v of vehicles) {
    const { driverId, passengerIds } = await getVehicleLoad(ctx, v.id);
    if (!driverId) continue;
    const cap = (v as any).capacity ?? 1;
    const used = 1 + passengerIds.length;
    if (used >= cap) continue;

    anyBoardable = true;
    const free = cap - used;
    const label = `🚕 ${(v as any).title ?? "وسیله"} (جای خالی: ${free})`;
    kb.text(label, `ride:req:${v.id}`).row();
  }

  kb.text("⬅️ بازگشت به حمل‌ونقل", "trans:menu");

  if (!anyBoardable) {
    await sendVehicleScreen(
      ctx,
      "وسیله‌هایی در این نقطه وجود دارند، اما هیچ‌کدام جای خالی برای مسافر ندارند.",
      kb
    );
    return;
  }

  await sendVehicleScreen(ctx, lines.join("\n"), kb);
}

/** فرستادن درخواست به رانندهٔ یک وسیله */
async function sendRideRequestToDriver(
  ctx: MyContext,
  vehicleId: number,
  passengerCharId: number
) {
  const { supabase } = ctx.services;

  const { vehicle } = await getVehicleById(ctx, vehicleId);
  if (!vehicle) return;

  const driverCharId = (vehicle as any).owner_char_id;

  const { data: driverChar, error: dErr } = await supabase
    .from("characters")
    .select("tg_id, char_name")
    .eq("id", driverCharId)
    .maybeSingle();

  if (dErr || !driverChar) {
    console.error("sendRideRequestToDriver driver error:", dErr);
    return;
  }

  const { data: passengerChar, error: pErr } = await supabase
    .from("characters")
    .select("char_name")
    .eq("id", passengerCharId)
    .maybeSingle();

  if (pErr || !passengerChar) {
    console.error("sendRideRequestToDriver passenger error:", pErr);
    return;
  }

  const driverTgId = driverChar.tg_id;
  if (!driverTgId) return;

  const kb = new InlineKeyboard()
    .text("✅ قبول", `ride:approve:${vehicleId}:${passengerCharId}`)
    .row()
    .text("❌ رد", `ride:reject:${vehicleId}:${passengerCharId}`);

  const text =
    `🚕 درخواست مسافر:\n\n` +
    `مسافر: ${passengerChar.char_name}\n` +
    `وسیله: ${(vehicle as any).title ?? "وسیله"} (#${vehicle.id})\n\n` +
    `می‌خواهی سوارش کنی؟`;

  try {
    await ctx.api.sendMessage(driverTgId, text, { reply_markup: kb });
  } catch (e) {
    console.error("sendRideRequestToDriver sendMessage error:", e);
  }
}

/** وقتی مسافر یک ماشین خاص را انتخاب می‌کند */
async function handleRideRequest(ctx: MyContext, vehicleId: number) {
  const { supabase } = ctx.services;
  const { char, errorText } = await getCharacterByTg(ctx);
  if (!char) {
    await ctx.reply(errorText ?? "پرونده‌ات را پیدا نکردم.");
    return;
  }

  const { vehicle, errorText: err2 } = await getVehicleById(ctx, vehicleId);
  if (!vehicle) {
    await ctx.reply(err2 ?? "وسیله‌ای با این مشخصات پیدا نشد.");
    return;
  }

  // اگر خودش راننده‌ی وسیله‌ای است
  if (char.riding_vehicle_id) {
    const { data: veh, error: vehErr } = await supabase
      .from("vehicles")
      .select("id, owner_char_id, title")
      .eq("id", char.riding_vehicle_id)
      .maybeSingle();

    if (!vehErr && veh && (veh as any).owner_char_id === char.id) {
      await ctx.reply(
        "الان خودت رانندهٔ یک وسیله هستی.\nبرای مسافر شدن باید اول از وسیله‌ات پیاده شوی."
      );
      return;
    }
  }

  const alreadyPassenger = await isCharacterPassenger(ctx, char.id);
  if (alreadyPassenger) {
    await ctx.reply("تو همین حالا مسافر یک وسیله‌ای هستی.");
    return;
  }

  if (
    !char.current_region_id ||
    !char.current_spot_id ||
    char.current_region_id !== (vehicle as any).current_region_id ||
    char.current_spot_id !== (vehicle as any).current_spot_id
  ) {
    await ctx.reply("برای سوار شدن باید کنار همان وسیله باشی.");
    return;
  }

  const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicleId);
  if (!driverId) {
    await ctx.reply("این وسیله الان راننده ندارد.");
    return;
  }

  const cap = (vehicle as any).capacity ?? 1;
  const used = 1 + passengerIds.length;
  if (used >= cap) {
    await ctx.reply("این وسیله دیگر جایی برای مسافر ندارد.");
    return;
  }

  await sendRideRequestToDriver(ctx, vehicleId, char.id);

  await ctx.reply(
    "درخواست سوار شدن برای رانندهٔ همین وسیله ارسال شد.\nباید ببینیم قبول می‌کند یا نه…"
  );
}

/** راننده قبول/رد می‌کند */
async function handleRideDecision(
  ctx: MyContext,
  vehicleId: number,
  passengerCharId: number,
  accepted: boolean
) {
  const { supabase } = ctx.services;

  const { char, errorText } = await getCharacterByTg(ctx);
  if (!char) {
    await ctx.reply(errorText ?? "پرونده‌ات را پیدا نکردم.");
    return;
  }

  const { vehicle, errorText: err2 } = await getVehicleById(ctx, vehicleId);
  if (!vehicle) {
    await ctx.reply(err2 ?? "وسیله‌ای پیدا نشد.");
    return;
  }

  // تو باید مالک و راننده همین وسیله باشی
  if (
    (vehicle as any).owner_char_id !== char.id ||
    char.riding_vehicle_id !== vehicleId
  ) {
    await ctx.reply("تو رانندهٔ این وسیله نیستی.");
    return;
  }

  const { data: passenger, error: pErr } = await supabase
    .from("characters")
    .select("id, tg_id, char_name")
    .eq("id", passengerCharId)
    .maybeSingle();

  if (pErr || !passenger) {
    await ctx.reply("مسافر موردنظر را پیدا نکردم.");
    return;
  }

  if (!accepted) {
    await ctx.reply("درخواست سوار شدن را رد کردی.");
    if (passenger.tg_id) {
      try {
        await ctx.api.sendMessage(
          passenger.tg_id,
          "راننده درخواست سوار شدنت را رد کرد."
        );
      } catch (e) {
        console.error("notify passenger reject error:", e);
      }
    }
    return;
  }

  const res = await addPassengerToVehicle(ctx, vehicleId, passenger.id);
  if (!res.ok) {
    await ctx.reply(res.errorText ?? "نتوانستم مسافر را سوار کنم.");
    if (passenger.tg_id) {
      try {
        await ctx.api.sendMessage(
          passenger.tg_id,
          "راننده سعی کرد تو را سوار کند اما جایی خالی نبود یا مشکلی پیش آمد."
        );
      } catch (e) {
        console.error("notify passenger fail error:", e);
      }
    }
    return;
  }

  await ctx.reply(
    `مسافر ${passenger.char_name} را سوار ${(vehicle as any).title ?? "وسیله"} کردی.`
  );

  if (passenger.tg_id) {
    try {
      await ctx.api.sendMessage(
        passenger.tg_id,
        `🚕 راننده تو را سوار ${(vehicle as any).title ?? "وسیله"} کرد.`
      );
    } catch (e) {
      console.error("notify passenger success error:", e);
    }
  }
}

/** حرکت وسیله + مسافران بین Spotها (الان فقط برای لاگ‌کردن مکان وسیله استفاده می‌شود) */
export async function moveVehicleWithPassengers(
  ctx: MyContext,
  vehicleId: number,
  fromSpotId: number | null,
  toSpotId: number | null
) {
  const { supabase } = ctx.services;

  const { data: vehicle, error: vehErr } = await supabase
    .from("vehicles")
    .select("*")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vehErr || !vehicle) {
    console.error("moveVehicleWithPassengers vehicle error:", vehErr);
    return;
  }

  await updateVehicleLocation(
    ctx,
    vehicleId,
    (vehicle as any).current_region_id,
    toSpotId
  );

  await logVehicleMove(ctx, vehicleId, fromSpotId, toSpotId, "drive");
}

/** لینک ورود به Region جدید برای راننده و مسافران (در حال حاضر group-arrive در travel.ts این کار را می‌کند) */
export async function sendVehicleArrivalLinks(
  ctx: MyContext,
  vehicleId: number,
  inviteLink: string
) {
  const { supabase } = ctx.services;

  const { vehicle } = await getVehicleById(ctx, vehicleId);
  if (!vehicle) return;

  const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicleId);
  const allCharIds = [
    ...(driverId ? [driverId] : []),
    ...passengerIds,
  ];

  if (allCharIds.length === 0) return;

  const { data: chars, error } = await supabase
    .from("characters")
    .select("id, tg_id, char_name")
    .in("id", allCharIds);

  if (error || !chars) {
    console.error("sendVehicleArrivalLinks chars error:", error);
    return;
  }

  for (const c of chars) {
    if (!c.tg_id) continue;
    const text =
      `🚗 ${(vehicle as any).title ?? "وسیله"} به مقصد جدید رسید.\n` +
      `مسیر برایت باز است تا وارد شوی.`;
    try {
      await ctx.api.sendMessage(c.tg_id, text, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "ورود به مکان جدید", url: inviteLink }],
          ],
        },
      });
    } catch (e) {
      console.error("sendVehicleArrivalLinks sendMessage error:", e);
    }
  }
}

/** رجیسترکردن همهٔ این فیچرها روی بات */
export function registerVehicleTravelFeature(bot: Bot<MyContext>) {
  // دکمه متنی «حمل و نقل» در پی‌وی (اگر کسی خودش بنویسد)
  bot.hears(/حمل.?و.?نقل/, async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await showTransportMenu(ctx);
  });

  // برگشت به پنل حمل‌ونقل
  bot.callbackQuery("trans:menu", async (ctx) => {
    try {
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.warn("answerCallbackQuery trans:menu failed:", e);
    }
    await showTransportMenu(ctx);
  });

  // «ماشین‌های من» از داخل حمل‌ونقل
  bot.callbackQuery("veh:my", async (ctx) => {
    try {
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.warn("answerCallbackQuery veh:my failed:", e);
    }
    await showMyVehiclesMenu(ctx);
  });

  // باز کردن جزئیات یک وسیله
  bot.callbackQuery(/^veh:open:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    try {
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.warn("answerCallbackQuery veh:open failed:", e);
    }
    await showVehicleDetail(ctx, id);
  });

  // سوار شدن راننده
  bot.callbackQuery(/^veh:drive:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    try {
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.warn("answerCallbackQuery veh:drive failed:", e);
    }
    await handleDriveVehicle(ctx, id);
  });

  // پیاده شدن راننده
  bot.callbackQuery(/^veh:leave:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    try {
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.warn("answerCallbackQuery veh:leave failed:", e);
    }
    await handleLeaveVehicle(ctx, id);
  });

  // لیست مسافران
  bot.callbackQuery(/^veh:passengers:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    try {
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.warn("answerCallbackQuery veh:passengers failed:", e);
    }
    await showVehiclePassengers(ctx, id);
  });

  // دکمه «🚕 سوار می‌شوم» در پنل حمل‌ونقل
  bot.callbackQuery("ride:menu", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      try {
        await ctx.answerCallbackQuery();
      } catch (e) {
        console.warn("answerCallbackQuery ride:menu (group) failed:", e);
      }
      return;
    }

    try {
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.warn("answerCallbackQuery ride:menu (pv) failed:", e);
    }

    await showRideMenu(ctx);
  });

  // انتخاب یک ماشین خاص برای سوار شدن
  bot.callbackQuery(/^ride:req:(\d+)$/, async (ctx) => {
    const vehicleId = Number(ctx.match[1]);
    try {
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.warn("answerCallbackQuery ride:req failed:", e);
    }
    await handleRideRequest(ctx, vehicleId);
  });

  // تصمیم راننده (قبول/رد)
  bot.callbackQuery(/^ride:(approve|reject):(\d+):(\d+)$/, async (ctx) => {
    const decision = ctx.match[1];
    const vehicleId = Number(ctx.match[2]);
    const passengerCharId = Number(ctx.match[3]);
    const accepted = decision === "approve";

    try {
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.warn("answerCallbackQuery ride:decision failed:", e);
    }

    await handleRideDecision(ctx, vehicleId, passengerCharId, accepted);
  });
}
