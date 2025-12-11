// src/features/world/travel-vehicles.ts
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

/** گرفتن وسیله‌ای که این کاراکتر راننده‌اش است (اگر باشد) */
async function getRidingVehicle(ctx: MyContext, charId: number) {
  const { supabase } = ctx.services;

  const { data, error } = await supabase
    .from("vehicles")
    .select("*")
    .eq("current_driver_char_id", charId)
    .maybeSingle();

  if (error) {
    console.error("getRidingVehicle error:", error);
    return { vehicle: null, errorText: "در خواندن وضعیت وسیله مشکلی پیش آمد." };
  }

  return { vehicle: data, errorText: null };
}

/** گرفتن وسیله از روی id */
async function getVehicleById(ctx: MyContext, vehicleId: number) {
  const { supabase } = ctx.services;
  const { data, error } = await supabase
    .from("vehicles")
    .select("*")
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

/** ثبت حرکت وسیله در vehicle_moves (ساده، بدون actor_*) */
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
export function computeFuelUsagePercent(driveSeconds: number): number {
  if (driveSeconds <= 0) return 0;
  // هر ۲ دقیقه (۱۲۰ ثانیه) = ۱٪
  return driveSeconds / 120;
}

/** تعداد راننده و مسافرهای یک وسیله */
export async function getVehiclePassengerCount(
  ctx: MyContext,
  vehicleId: number
) {
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

/** حذف مسافر از همهٔ وسیله‌ها (برای ری‌ست شدن تمیز) */
/** حذف مسافر از همهٔ وسیله‌ها (برای ری‌ست شدن تمیز) */
async function removePassengerFromAllVehicles(
  ctx: MyContext,
  charId: number
): Promise<void> {
  const { supabase } = ctx.services;

  // همه رکوردهای مسافر این کاراکتر را پاک کن
  const { error } = await supabase
    .from("vehicle_passengers")
    .delete()
    .eq("character_id", charId);

  if (error) {
    console.error("removePassengerFromAllVehicles error:", error);
  }

  // riding_vehicle_id را هم خالی کن
  const { error: updErr } = await supabase
    .from("characters")
    .update({ riding_vehicle_id: null })
    .eq("id", charId);

  if (updErr) {
    console.error("removePassengerFromAllVehicles char update error:", updErr);
  }
}

/** افزودن یک مسافر به وسیله */
async function addPassengerToVehicle(
  ctx: MyContext,
  vehicleId: number,
  charId: number
): Promise<{ ok: boolean; errorText?: string }> {
  const { supabase } = ctx.services;

  const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicleId);

  const { data: veh, error: vehError } = await supabase
    .from("vehicles")
    .select("capacity, passenger_locked")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vehError || !veh) {
    console.error("addPassengerToVehicle get vehicle error:", vehError);
    return { ok: false, errorText: "نتوانستم وسیله را پیدا کنم." };
  }

  // اگر قفل است، اصلاً اجازه ندیم
  if (veh.passenger_locked) {
    return {
      ok: false,
      errorText: "راننده صندلی‌های مسافر را قفل کرده است.",
    };
  }

  const cap = veh.capacity ?? 1;
  const usedSeats = (driverId ? 1 : 0) + passengerIds.length;
  if (usedSeats >= cap) {
    return { ok: false, errorText: "این وسیله دیگر جایی برای مسافر ندارد." };
  }

  await removePassengerFromAllVehicles(ctx, charId);

  const { error } = await supabase.from("vehicle_passengers").insert({
    vehicle_id: vehicleId,
    character_id: charId,
  });

  if (error) {
    console.error("addPassengerToVehicle insert error:", error);
    return { ok: false, errorText: "در ثبت مسافر جدید مشکلی پیش آمد." };
  }

  // riding_vehicle_id را هم ست کنیم
  const { error: updErr } = await supabase
    .from("characters")
    .update({ riding_vehicle_id: vehicleId })
    .eq("id", charId);

  if (updErr) {
    console.error("addPassengerToVehicle char update error:", updErr);
  }

  return { ok: true };
}


/** حذف یک مسافر از یک وسیله خاص */
/** حذف یک مسافر از یک وسیله خاص */
async function removePassengerFromVehicle(
  ctx: MyContext,
  vehicleId: number,
  charId: number
): Promise<void> {
  const { supabase } = ctx.services;

  const { error } = await supabase
    .from("vehicle_passengers")
    .delete()
    .eq("vehicle_id", vehicleId)
    .eq("character_id", charId);

  if (error) {
    console.error("removePassengerFromVehicle error:", error);
  }

  // اگر هنوز سوار همین وسیله ثبت شده، riding_vehicle_id را خالی کن
  const { error: charErr } = await supabase
    .from("characters")
    .update({ riding_vehicle_id: null })
    .eq("id", charId)
    .eq("riding_vehicle_id", vehicleId);

  if (charErr) {
    console.error("removePassengerFromVehicle char update error:", charErr);
  }
}

/** ارسال/آپدیت منوی حمل‌ونقل/ماشین‌/مسافر با پاک‌کردن منوی قبلی */
async function sendVehicleScreen(
  ctx: MyContext,
  text: string,
  keyboard: InlineKeyboard
) {
  const lastId = (ctx.session as any).ui_last_message_id as
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
    (ctx.session as any).ui_last_message_id = msg.message_id;
  }
}

/** منوی کلی حمل‌ونقل (فعلاً ساده؛ بعداً می‌تونیم حذفش کنیم) */
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

    const { data: wells, error: wellErr } = await supabase
      .from("flux_wells")
      .select("id")
      .eq("region_id", char.current_region_id)
      .eq("spot_id", char.current_spot_id);

    if (wellErr) console.error("showTransportMenu wells error:", wellErr);
    hasFlux = !!wells && wells.length > 0;
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
    .select("id, title, display_name, capacity, current_region_id, current_spot_id")
    .eq("owner_char_id", char.id);

  if (error) {
    console.error("showMyVehiclesMenu vehicles error:", error);
    await ctx.reply("در خواندن لیست وسیله‌ها مشکلی پیش آمد.");
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    await sendVehicleScreen(
      ctx,
      "در دفتر اکلیس برایت وسیلهٔ نقلیه‌ای ثبت نشده.\nوقتی در شاپ وسیله بخری، از اینجا می‌توانی مدیریتشان کنی.",
      new InlineKeyboard().text("⬅️ بازگشت", "trans:menu")
    );
    return;
  }

  const kb = new InlineKeyboard();
  for (const v of vehicles) {
    const name = v.display_name ?? v.title ?? "وسیله";
    const label = `${name} (#${v.id})`;
    kb.text(label, `veh:open:${v.id}`).row();
  }
  kb.text("⬅️ بازگشت", "trans:menu");

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

  if (vehicle.owner_char_id !== char.id) {
    await ctx.reply("این وسیله متعلق به تو نیست.");
    return;
  }

  const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicleId);
  const cap = vehicle.capacity ?? 1;
  const used = (driverId ? 1 : 0) + passengerIds.length;
  const free = cap - used;

  const lines: string[] = [];
  lines.push(`🚗 ${vehicle.display_name ?? vehicle.title ?? "وسیلهٔ ناشناس"} (#${vehicle.id})`);
  lines.push("");
  lines.push(`ظرفیت کلی: ${cap}`);
  lines.push(`صندلی‌های پر: ${used}`);
  lines.push(`صندلی‌های خالی: ${free < 0 ? 0 : free}`);
  lines.push("");
  if (driverId) lines.push("وضعیت: در حال رانندگی");
  else lines.push("وضعیت: پارک شده");

  // وضعیت قفل بودن برای مسافرها
  const locked = !!vehicle.locked_for_passengers;
  lines.push(
    locked
      ? "درها: 🔒 بسته روی مسافرها (هیچ‌کس نمی‌تواند درخواست بدهد)"
      : "درها: 🔓 باز برای مسافرها"
  );

  const kb = new InlineKeyboard();

  // فقط صاحب وسیله می‌تواند قفل را عوض کند
  if (vehicle.owner_char_id === char.id) {
    const lockLabel = locked
      ? "🔓 باز کردن برای مسافرها"
      : "🔒 بستن برای مسافرها";
    kb.text(lockLabel, `veh:lock:${vehicle.id}`).row();
  }

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
  if (!vehicle || vehicle.owner_char_id !== char.id) {
    await ctx.reply("به این وسیله دسترسی نداری.");
    return;
  }

  // فقط وقتی کنار وسیله‌ای اجازه بده
  if (
    !char.current_region_id ||
    !char.current_spot_id ||
    char.current_region_id !== vehicle.current_region_id ||
    char.current_spot_id !== vehicle.current_spot_id
  ) {
    await ctx.reply("برای دیدن وضعیت مسافران باید کنار همین وسیله باشی.");
    return;
  }

  const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicleId);
  const lines: string[] = [];
  lines.push(`🚕 مسافران ${vehicle.display_name ?? vehicle.title ?? "وسیله"} (#${vehicle.id})`);
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
    .text("⬅️ بازگشت", "veh:my");

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

  // این وسیله مال توست؟
  if (vehicle.owner_char_id !== char.id) {
    await ctx.reply("این وسیله متعلق به تو نیست.");
    return;
  }

  // حتماً باید کنار وسیله باشی
  if (
    !char.current_region_id ||
    !char.current_spot_id ||
    char.current_region_id !== vehicle.current_region_id ||
    char.current_spot_id !== vehicle.current_spot_id
  ) {
    await ctx.reply("برای سوار شدن باید کنار همین وسیله باشی.");
    return;
  }

  // اگر الان راننده‌ی وسیله‌ی دیگری هستی، اول خالی‌شان کن
  const { data: otherVehicles, error: ovErr } = await supabase
    .from("vehicles")
    .select("id")
    .eq("current_driver_char_id", char.id);

  if (!ovErr && otherVehicles && otherVehicles.length > 0) {
    const otherIds = otherVehicles.map((v) => v.id);
    const { error: clearErr } = await supabase
      .from("vehicles")
      .update({ current_driver_char_id: null })
      .in("id", otherIds);
    if (clearErr) {
      console.error("handleDriveVehicle clear other vehicles error:", clearErr);
    }
  }

  // این وسیله را رانندگی کن
  const { error } = await supabase
    .from("vehicles")
    .update({ current_driver_char_id: char.id })
    .eq("id", vehicleId);

  if (error) {
    console.error("handleDriveVehicle update error:", error);
    await ctx.reply("در سوار شدن مشکلی پیش آمد.");
    return;
  }

  // توی رکورد کاراکتر هم بگو سوار چه ماشینی هستی
  const { error: charErr } = await supabase
    .from("characters")
    .update({ riding_vehicle_id: vehicleId })
    .eq("id", char.id);

  if (charErr) {
    console.error("handleDriveVehicle char update error:", charErr);
  }

  await ctx.reply(
    `🕹 تو حالا رانندهٔ ${vehicle.display_name ?? vehicle.title ?? "وسیله"} شدی.\n` +
    `برای دیدن مسیرهای رانندگی، از «🧭 مسیر های من» استفاده کن.`
  );
}



/** پیاده شدن راننده از وسیله */
/** پیاده شدن از وسیله (راننده یا مسافر) */
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

  if (vehicle.current_driver_char_id !== char.id) {
    await ctx.reply("الان رانندهٔ این وسیله نیستی.");
    return;
  }

  const { error } = await supabase
    .from("vehicles")
    .update({ current_driver_char_id: null })
    .eq("id", vehicleId);

  if (error) {
    console.error("handleLeaveVehicle update error:", error);
    await ctx.reply("در پیاده شدن مشکلی پیش آمد.");
    return;
  }

  // از روی کاراکتر هم پاکش کن
  const { error: charErr } = await supabase
    .from("characters")
    .update({ riding_vehicle_id: null })
    .eq("id", char.id)
    .eq("riding_vehicle_id", vehicleId);

  if (charErr) {
    console.error("handleLeaveVehicle char update error:", charErr);
  }

  await ctx.reply(
    `🕹 از ${vehicle.display_name ?? vehicle.title ?? "وسیله"} پیاده شدی. وسیله در همین نقطه می‌ماند.`
  );
}

/** قفل/باز کردن اجازه‌ی سوار شدن مسافران توسط صاحب وسیله */
async function toggleVehiclePassengerLock(
  ctx: MyContext,
  vehicleId: number
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

  if (vehicle.owner_char_id !== char.id) {
    await ctx.reply("فقط صاحب وسیله می‌تواند قفل مسافران را عوض کند.");
    return;
  }

  const current = !!vehicle.passenger_locked;

  const { error } = await supabase
    .from("vehicles")
    .update({ passenger_locked: !current })
    .eq("id", vehicleId);

  if (error) {
    console.error("toggleVehiclePassengerLock update error:", error);
    await ctx.reply("در تغییر وضعیت قفل مسافران مشکلی پیش آمد.");
    return;
  }

  await ctx.reply(
    !current
      ? "درِ این وسیله را برای مسافران قفل کردی. دیگر در لیست سواری‌ها نمایش داده نمی‌شود."
      : "قفل مسافران را باز کردی. حالا مسافران می‌توانند درخواست سوار شدن بفرستند."
  );
}


/** منوی مسافر شدن: لیست ماشین‌های حاضر در همین نقطه */
/** منوی مسافر شدن: لیست ماشین‌های حاضر در همین نقطه */
async function showRideMenu(ctx: MyContext) {
  const { supabase } = ctx.services;
  const { char, errorText } = await getCharacterByTg(ctx);
  if (!char) {
    await ctx.reply(errorText ?? "پرونده‌ات را پیدا نکردم.");
    return;
  }

  // اگر خودش راننده است، اجازه‌ی مسافر شدن ندارد
  const { vehicle: drivingVehicle } = await getRidingVehicle(ctx, char.id);
  if (drivingVehicle) {
    await ctx.reply(
      "الان خودت رانندهٔ یک وسیله هستی.\nبرای مسافر شدن باید اول از وسیله‌ات پیاده شوی."
    );
    return;
  }

  // اگر همین الان توی vehicle_passengers ثبت شده، یعنی مسافرِ یک وسیله است
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

  // همه‌ی وسیله‌هایی که دقیقاً در همین Region/Spot پارک شده‌اند
  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select(
      "id, display_name, capacity, current_region_id, current_spot_id, passenger_locked"
    )
    .eq("current_region_id", char.current_region_id)
    .eq("current_spot_id", char.current_spot_id);

  if (error) {
    console.error("showRideMenu vehicles error:", error);
    await ctx.reply("در خواندن وسیله‌های این نقطه مشکلی پیش آمد.");
    return;
  }

  // هیچ وسیله‌ای اینجا نیست
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
  // اگر قفل است، این وسیله اصلاً در لیست مسافرها نمایش داده نشود
  if (v.passenger_locked) continue;

  const { driverId, passengerIds } = await getVehicleLoad(ctx, v.id);
  if (!driverId) continue;
  const cap = v.capacity ?? 1;
  const used = 1 + passengerIds.length;
  if (used >= cap) continue;

  anyBoardable = true;
  const free = cap - used;
  const label = `🚕 ${v.display_name ?? "وسیله"} (جای خالی: ${free})`;
  kb.text(label, `ride:req:${v.id}`).row();
}


  kb.text("⬅️ بازگشت", "trans:menu");

  if (!anyBoardable) {
    await sendVehicleScreen(
      ctx,
      "وسیله‌هایی در این نقطه وجود دارند، اما هیچ‌کدام جای خالی برای مسافر ندارند یا قفل هستند.",
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
  if (!vehicle || !vehicle.current_driver_char_id) return;

  const driverCharId = vehicle.current_driver_char_id;

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
    `وسیله: ${vehicle.title ?? "وسیله"} (#${vehicle.id})\n\n` +
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
    if (vehicle.passenger_locked) {
    await ctx.reply("این وسیله فعلاً قفل است و مسافر جدید قبول نمی‌کند.");
    return;
  }


  const { vehicle: drivingVehicle } = await getRidingVehicle(ctx, char.id);
  if (drivingVehicle) {
    await ctx.reply(
      "الان خودت رانندهٔ یک وسیله هستی.\nبرای مسافر شدن باید اول از وسیله‌ات پیاده شوی."
    );
    return;
  }

  const alreadyPassenger = await isCharacterPassenger(ctx, char.id);
  if (alreadyPassenger) {
    await ctx.reply("تو همین حالا مسافر یک وسیله‌ای هستی.");
    return;
  }

  if (
    !char.current_region_id ||
    !char.current_spot_id ||
    char.current_region_id !== vehicle.current_region_id ||
    char.current_spot_id !== vehicle.current_spot_id
  ) {
    await ctx.reply("برای سوار شدن باید کنار همان وسیله باشی.");
    return;
  }

  const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicleId);
  if (!driverId) {
    await ctx.reply("این وسیله الان راننده ندارد.");
    return;
  }

  const cap = vehicle.capacity ?? 1;
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

  if (vehicle.current_driver_char_id !== char.id) {
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
    `مسافر ${passenger.char_name} را سوار ${vehicle.title ?? "وسیله"} کردی.`
  );

  if (passenger.tg_id) {
    try {
      await ctx.api.sendMessage(
        passenger.tg_id,
        `🚕 راننده تو را سوار ${vehicle.title ?? "وسیله"} کرد.`
      );
    } catch (e) {
      console.error("notify passenger success error:", e);
    }
  }
}

/** حرکت وسیله + مسافران بین Spotها (برای آینده؛ فعلاً از handleArrive استفاده می‌کنیم) */
export async function moveVehicleWithPassengers(
  ctx: MyContext,
  vehicleId: number,
  fromSpotId: number | null,
  toSpotId: number | null
) {
  const { supabase } = ctx.services;

  // وسیله را بگیر
  const { data: vehicle, error: vehErr } = await supabase
    .from("vehicles")
    .select("*")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vehErr || !vehicle) {
    console.error("moveVehicleWithPassengers vehicle error:", vehErr);
    return;
  }

  // اگر سوخت ندارد، اصلاً اجازه حرکت نده
  const fuel = vehicle.fuel_percent ?? 0;
  if (fuel <= 0) {
    console.warn("moveVehicleWithPassengers: fuel empty, cannot move.");
    // اینجا می‌تونی پیام هم برای راننده بفرستی، اگر خواستی
    return;
  }

  // مدت رانندگی را از edges دربیاوریم
  let driveSeconds = 0;
  if (fromSpotId && toSpotId) {
    const { data: edge, error: edgeErr } = await supabase
      .from("edges")
      .select("drive_seconds, travel_seconds")
      .eq("from_spot_id", fromSpotId)
      .eq("to_spot_id", toSpotId)
      .maybeSingle();

    if (edgeErr) {
      console.error("moveVehicleWithPassengers edge error:", edgeErr);
    } else if (edge) {
      driveSeconds = edge.drive_seconds ?? edge.travel_seconds ?? 0;
    }
  }

  const fuelUsage = computeFuelUsagePercent(driveSeconds);
  const newFuel = Math.max(0, fuel - fuelUsage);

  // لوکیشن + سوخت را آپدیت کن
  const { error: updVehErr } = await supabase
    .from("vehicles")
    .update({
      current_region_id: vehicle.current_region_id,
      current_spot_id: toSpotId,
      fuel_percent: newFuel,
    })
    .eq("id", vehicleId);

  if (updVehErr) {
    console.error("moveVehicleWithPassengers vehicle update error:", updVehErr);
  }

  // لاگ حرکت
  await logVehicleMove(ctx, vehicleId, fromSpotId, toSpotId, "drive");

  // راننده + مسافران
  const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicleId);
  const involvedCharIds = [
    ...(driverId ? [driverId] : []),
    ...passengerIds,
  ];

  if (involvedCharIds.length === 0) return;

  const { error: updErr } = await supabase
    .from("characters")
    .update({
      current_region_id: vehicle.current_region_id,
      current_spot_id: toSpotId,
    })
    .in("id", involvedCharIds);

  if (updErr) {
    console.error("moveVehicleWithPassengers char update error:", updErr);
  }
}


/** رجیسترکردن همهٔ این فیچرها روی بات */
export function registerVehicleTravelFeature(bot: Bot<MyContext>) {
  // دکمه متنی «حمل و نقل» در پی‌وی
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

    // قفل/باز کردن ماشین برای مسافرها
  bot.callbackQuery(/^veh:lock:(\d+)$/, async (ctx) => {
    const vehicleId = Number(ctx.match[1]);
    try {
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.warn("answerCallbackQuery veh:lock failed:", e);
    }

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

    if (vehicle.owner_char_id !== char.id) {
      await ctx.reply("فقط صاحب وسیله می‌تواند آن را برای مسافران قفل/باز کند.");
      return;
    }

    const newLocked = !vehicle.locked_for_passengers;
    const { error } = await supabase
      .from("vehicles")
      .update({ locked_for_passengers: newLocked })
      .eq("id", vehicleId);

    if (error) {
      console.error("veh:lock update error:", error);
      await ctx.reply("در تغییر وضعیت قفل مشکلی پیش آمد.");
      return;
    }

    await showVehicleDetail(ctx, vehicleId);
  });

    // قفل/باز کردن مسافران
  bot.callbackQuery(/^veh:lock:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    try {
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.warn("answerCallbackQuery veh:lock failed:", e);
    }
    await toggleVehiclePassengerLock(ctx, id);
  });

}
