import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { hasBoardableVehicleHere, getVehicleLoad } from "./vehicle-helpers";

/**
 * خواندن کاراکتر بر اساس tg_id
 */
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

/**
 * خواندن وسیلهٔ نقلیه‌ی فعلی کاراکتر (اگر سوار باشد)
 */
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

/**
 * خواندن وسیله بر اساس id
 */
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

/**
 * آپدیت لوکیشن وسیله
 */
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

/**
 * ثبت حرکت وسیله در vehicle_moves
 * (فعلاً بدون actor_* تا با دیتابیس درگیر نشیم)
 */
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

/**
 * هر ۱٪ سوخت ≈ ۲ دقیقه رانندگی
 */
function computeFuelUsagePercent(driveSeconds: number): number {
  if (driveSeconds <= 0) return 0;
  return driveSeconds / 120;
}

/**
 * تعداد راننده و مسافرهای یک وسیله
 */
async function getVehiclePassengerCount(ctx: MyContext, vehicleId: number) {
  const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicleId);
  const driverCount = driverId ? 1 : 0;
  const passengerCount = passengerIds.length;
  return { driverCount, passengerCount, total: driverCount + passengerCount };
}

/**
 * آیا این کاراکتر الان مسافر وسیله‌ای هست یا نه
 */
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

/**
 * خارج کردن کاراکتر از لیست مسافران هر وسیله
 */
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

/**
 * افزودن یک مسافر به وسیله
 */
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

  const cap = veh.capacity ?? 1;
  const usedSeats = (driverId ? 1 : 0) + passengerIds.length;
  if (usedSeats >= cap) {
    return { ok: false, errorText: "این وسیله دیگر جایی برای مسافر ندارد." };
  }

  // اول مطمئن شو این کاراکتر در هیچ وسیله دیگری مسافر نیست
  await removePassengerFromAllVehicles(ctx, charId);

  const { error } = await supabase.from("vehicle_passengers").insert({
    vehicle_id: vehicleId,
    character_id: charId,
  });

  if (error) {
    console.error("addPassengerToVehicle insert error:", error);
    return { ok: false, errorText: "در ثبت مسافر جدید مشکلی پیش آمد." };
  }

  return { ok: true };
}

/**
 * خارج کردن یک مسافر از یک وسیله
 */
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
}

/**
 * نمایش پیام منوی حمل‌ونقل / ماشین‌ها / مسافر شدن
 * با پاک کردن پیام قبلی منو
 */
async function sendVehicleScreen(
  ctx: MyContext,
  text: string,
  keyboard: InlineKeyboard
) {
  // پاک کردن پیام قبلی منو اگر داریم
  const lastId = ctx.session.ui_last_menu_id;
  if (lastId && ctx.chat?.type === "private") {
    try {
      await ctx.api.deleteMessage(ctx.chat.id, lastId);
    } catch {
      // اهمیتی ندارد
    }
  }

  const msg = await ctx.reply(text, {
    reply_markup: keyboard,
  });

  if (ctx.chat?.type === "private") {
    ctx.session.ui_last_menu_id = msg.message_id;
  }
}

/**
 * منوی کلی حمل‌ونقل: ماشین‌ها / مونت‌ها / سوار می‌شوم / سوخت‌گیری
 */
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

  // آیا خودش ماشین دارد؟
  const { data: vehicles, error: vehErr } = await supabase
    .from("vehicles")
    .select("id")
    .eq("owner_char_id", char.id);

  if (vehErr) {
    console.error("showTransportMenu vehicles error:", vehErr);
  }

  const hasOwnedVehicles = !!vehicles && vehicles.length > 0;

  let canBoard = false;
  let hasFlux = false;
  // (بعداً) let hasMounts = false;
  // (بعداً) let hasTransit = false;

  if (char.current_region_id && char.current_spot_id) {
    // آیا در این نقطه وسیله‌ای برای سوار شدن هست؟
    canBoard = await hasBoardableVehicleHere(
      ctx,
      char.current_region_id,
      char.current_spot_id
    );

    // آیا این spot چاه فلوکس دارد؟
    const { data: wells, error: wellErr } = await supabase
      .from("flux_wells")
      .select("id")
      .eq("region_id", char.current_region_id)
      .eq("spot_id", char.current_spot_id);

    if (wellErr) {
      console.error("showTransportMenu wells error:", wellErr);
    }
    hasFlux = !!wells && wells.length > 0;
  }

  const kb = new InlineKeyboard();

  // 🚗 ماشین‌های من
  if (hasOwnedVehicles) {
    kb.text("🚗 ماشین‌های من", "veh:my").row();
    lines.push("• ماشین‌هایت را از اینجا مدیریت می‌کنی.");
  }

  // 🐎 مونت‌های من (بعداً)
  // if (hasMounts) {
  //   kb.text("🐎 مونت‌های من", "mount:my").row();
  //   lines.push("• مونت‌هایت را از اینجا صدا می‌زنی.");
  // }

  // 🚕 سوار می‌شوم (مسافر شدن)
  if (canBoard) {
    kb.text("🚕 سوار می‌شوم", "ride:menu").row();
    lines.push("• می‌توانی سوار یکی از وسیله‌های حاضر در این نقطه شوی.");
  }

  // ⛽ سوخت‌گیری
  if (hasFlux) {
    kb.text("⛽ سوخت‌گیری", "flux:fuel").row();
    lines.push("• در این نقطه چاه فلوکس فعال است.");
  }

  // 🚝 حمل‌ونقل سریع (بعداً)
  // if (hasTransit) {
  //   kb.text("🚝 حمل‌ونقل سریع", "transit:menu").row();
  //   lines.push("• اینجا ایستگاه حمل‌ونقل سریع است.");
  // }

  kb.text("⬅️ بازگشت به منوی اصلی", "ui:home");

  if (!hasOwnedVehicles && !canBoard && !hasFlux) {
    lines.push(
      "فعلاً نه وسیله‌ای برای خودت داری، نه چیزی این اطراف برای سوار شدن، نه چاه فلوکس."
    );
    lines.push("وقتی شاپ برایت وسیله ثبت کند یا به نقطهٔ مناسب برسی، این‌جا زنده می‌شود.");
  }

  await sendVehicleScreen(ctx, lines.join("\n"), kb);
}

/**
 * منوی «ماشین های من»
 */
async function showMyVehiclesMenu(ctx: MyContext) {
  const { supabase } = ctx.services;
  const { char, errorText } = await getCharacterByTg(ctx);

  if (!char) {
    await ctx.reply(errorText ?? "پرونده‌ات را پیدا نکردم.");
    return;
  }

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("*")
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
    const label = `${v.display_name ?? "وسیله"} (#${v.id})`;
    kb.text(label, `veh:open:${v.id}`).row();
  }
  kb.text("⬅️ بازگشت به حمل‌ونقل", "trans:menu");

  await sendVehicleScreen(ctx, "🚗 ماشین‌ها و وسیله‌های تو:", kb);
}

/**
 * نمایش صفحه‌ی یک وسیلهٔ خاص (برای صاحبش)
 */
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
  lines.push(`🚗 ${vehicle.display_name ?? "وسیلهٔ ناشناس"} (#${vehicle.id})`);
  lines.push("");
  lines.push(`ظرفیت کلی: ${cap}`);
  lines.push(`صندلی‌های پر: ${used}`);
  lines.push(`صندلی‌های خالی: ${free < 0 ? 0 : free}`);
  lines.push("");
  if (driverId) {
    lines.push("وضعیت: در حال رانندگی");
  } else {
    lines.push("وضعیت: پارک شده");
  }

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

/**
 * نمایش لیست مسافران یک وسیله (برای صاحب)
 */
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

  const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicleId);
  const lines: string[] = [];
  lines.push(`🚕 مسافران ${vehicle.display_name ?? "وسیله"} (#${vehicle.id})`);
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
      if (!err1 && driver) {
        lines.push(`🕹 راننده: ${driver.char_name}`);
      }
    }

    if (passengerIds.length > 0) {
      lines.push("");
      lines.push("🚕 مسافران:");
      const { data: chars, error: err2 } = await supabase
        .from("characters")
        .select("id, char_name")
        .in("id", passengerIds);
      if (!err2 && chars) {
        for (const c of chars) {
          lines.push(`• ${c.char_name}`);
        }
      }
    }
  }

  const kb = new InlineKeyboard()
    .text("⬅️ بازگشت به وسیله", `veh:open:${vehicle.id}`)
    .row()
    .text("⬅️ بازگشت به ماشین‌هایم", "veh:my");

  await sendVehicleScreen(ctx, lines.join("\n"), kb);
}

/**
 * رانندگی با وسیله (ست کردن current_driver_char_id و ...)
 */
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

  if (vehicle.owner_char_id !== char.id) {
    await ctx.reply("این وسیله متعلق به تو نیست.");
    return;
  }

  // اگر هم‌اکنون راننده دارد و آن راننده تو نیستی
  if (vehicle.current_driver_char_id && vehicle.current_driver_char_id !== char.id) {
    await ctx.reply("الان فرد دیگری پشت فرمون این وسیله است.");
    return;
  }

  // اگر خود کاراکتر در حال حاضر رانندهٔ وسیلهٔ دیگری است، اول آن را آزاد کن
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

  const { error } = await supabase
    .from("vehicles")
    .update({ current_driver_char_id: char.id })
    .eq("id", vehicleId);

  if (error) {
    console.error("handleDriveVehicle update error:", error);
    await ctx.reply("در سوار شدن مشکلی پیش آمد.");
    return;
  }

  await ctx.reply(`🕹 تو حالا رانندهٔ ${vehicle.display_name ?? "وسیله"} شدی.`);
}

/**
 * پیاده شدن راننده از وسیله
 */
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

  await ctx.reply(
    `🕹 از ${vehicle.display_name ?? "وسیله"} پیاده شدی. وسیله در همین نقطه می‌ماند.`
  );
}

/**
 * منوی مسافر شدن
 */
async function showRideMenu(ctx: MyContext) {
  const { char, errorText } = await getCharacterByTg(ctx);
  if (!char) {
    await ctx.reply(errorText ?? "پرونده‌ات را پیدا نکردم.");
    return;
  }

  // اگر خودش رانندهٔ وسیله‌ای است
  const { vehicle: drivingVehicle } = await getRidingVehicle(ctx, char.id);
  if (drivingVehicle) {
    await ctx.reply(
      "الان خودت رانندهٔ یک وسیله هستی.\nبرای مسافر شدن باید اول از وسیله‌ات پیاده شوی."
    );
    return;
  }

  // اگر خودش مسافر وسیله‌ای است
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

  const canBoard = await hasBoardableVehicleHere(
    ctx,
    char.current_region_id,
    char.current_spot_id
  );

  if (!canBoard) {
    const kb = new InlineKeyboard().text(
      "⬅️ بازگشت به حمل‌ونقل",
      "trans:menu"
    );
    await sendVehicleScreen(
      ctx,
      "در این نقطه وسیله‌ای برای سوار شدن به عنوان مسافر پیدا نکردم.",
      kb
    );
    return;
  }

  const kb = new InlineKeyboard()
    .text("درخواست سوار شدن بفرست", "ride:req")
    .row()
    .text("⬅️ بازگشت به حمل‌ونقل", "trans:menu");

  await sendVehicleScreen(
    ctx,
    "🚕 می‌توانی در این نقطه سوار یکی از وسیله‌ها شوی.\nدرخواست سوار شدن را بفرست تا به راننده برسد.",
    kb
  );
}

/**
 * پیدا کردن یک وسیلهٔ مناسب برای سوار شدن مسافر
 * (فعلاً: اولین وسیله با ظرفیت خالی)
 */
async function findBoardableVehicleForPassenger(ctx: MyContext, charId: number) {
  const { supabase } = ctx.services;
  const { char } = await getCharacterByTg(ctx);
  if (!char || !char.current_region_id || !char.current_spot_id) {
    return null;
  }

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, capacity, current_region_id, current_spot_id")
    .eq("current_region_id", char.current_region_id)
    .eq("current_spot_id", char.current_spot_id);

  if (error) {
    console.error("findBoardableVehicleForPassenger vehicles error:", error);
    return null;
  }

  if (!vehicles || vehicles.length === 0) return null;

  for (const v of vehicles) {
    const { driverId, passengerIds } = await getVehicleLoad(ctx, v.id);
    if (!driverId) continue;
    const usedSeats = 1 + passengerIds.length;
    const cap = (v as any).capacity ?? 1;
    if (usedSeats < cap) {
      return v.id;
    }
  }

  return null;
}

/**
 * متنی برای راننده وقتی یک مسافر درخواست می‌دهد
 */
async function sendRideRequestToDriver(
  ctx: MyContext,
  vehicleId: number,
  passengerCharId: number
) {
  const { supabase } = ctx.services;

  const { vehicle } = await getVehicleById(ctx, vehicleId);
  if (!vehicle || !vehicle.current_driver_char_id) {
    return;
  }

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
  if (!driverTgId) {
    return;
  }

  const kb = new InlineKeyboard()
    .text("✅ قبول", `ride:approve:${vehicleId}:${passengerCharId}`)
    .row()
    .text("❌ رد", `ride:reject:${vehicleId}:${passengerCharId}`);

  const text = `🚕 درخواست مسافر:\n\n` +
    `مسافر: ${passengerChar.char_name}\n` +
    `وسیله: ${vehicle.display_name ?? "وسیله"} (#${vehicle.id})\n\n` +
    `می‌خواهی سوارش کنی؟`;

  try {
    await ctx.api.sendMessage(driverTgId, text, {
      reply_markup: kb,
    });
  } catch (e) {
    console.error("sendRideRequestToDriver sendMessage error:", e);
  }
}

/**
 * وقتی مسافر می‌گوید «درخواست سوار شدن»
 */
async function handleRideRequest(ctx: MyContext) {
  const { char, errorText } = await getCharacterByTg(ctx);
  if (!char) {
    await ctx.reply(errorText ?? "پرونده‌ات را پیدا نکردم.");
    return;
  }

  const alreadyPassenger = await isCharacterPassenger(ctx, char.id);
  if (alreadyPassenger) {
    await ctx.reply("تو همین حالا مسافر یک وسیله‌ای هستی.");
    return;
  }

  if (!char.current_region_id || !char.current_spot_id) {
    await ctx.reply("مکان فعلی‌ات مشخص نیست.");
    return;
  }

  const vehicleId = await findBoardableVehicleForPassenger(ctx, char.id);
  if (!vehicleId) {
    await ctx.reply("الان وسیله‌ای با ظرفیت خالی در این نقطه پیدا نکردم.");
    return;
  }

  await sendRideRequestToDriver(ctx, vehicleId, char.id);

  await ctx.reply(
    "درخواست سوار شدن به راننده فرستاده شد.\nببینیم که آیا قبول می‌کند یا نه…"
  );
}

/**
 * ثبت پاسخ راننده (قبول/رد)
 */
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
    `مسافر ${passenger.char_name} را سوار ${vehicle.display_name ?? "وسیله"} کردی.`
  );

  if (passenger.tg_id) {
    try {
      await ctx.api.sendMessage(
        passenger.tg_id,
        `🚕 راننده تو را سوار ${vehicle.display_name ?? "وسیله"} کرد.`
      );
    } catch (e) {
      console.error("notify passenger success error:", e);
    }
  }
}

/**
 * وقتی راننده با وسیله بین Spotها حرکت می‌کند،
 * باید مسافران هم همراهش جابه‌جا شوند.
 * این تابع را در travel.ts صدا می‌زنیم.
 */
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
    vehicle.current_region_id,
    toSpotId
  );

  await logVehicleMove(ctx, vehicleId, fromSpotId, toSpotId, "drive");

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

/**
 * هندل کردن لینک ورود برای راننده و مسافران
 * این را travel.ts وقتی بین Regionها حرکت می‌کنیم صدا می‌زند.
 */
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
      `🚗 ${vehicle.display_name ?? "وسیله"} به مقصد جدید رسید.\n` +
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

/**
 * ثبت فیچرهای مرتبط با وسیله و مسافر در بات
 */
export function registerVehicleTravelFeature(bot: Bot<MyContext>) {
  // دکمه متنی «حمل و نقل» در پی‌وی
  bot.hears(/حمل.?و.?نقل/, async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await showTransportMenu(ctx);
  });

  // باز کردن پنل حمل‌ونقل از دکمه‌ی برگشت
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
    const match = ctx.match;
    const id = Number(match[1]);
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

  // مسافران یک وسیله
  bot.callbackQuery(/^veh:passengers:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    try {
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.warn("answerCallbackQuery veh:passengers failed:", e);
    }
    await showVehiclePassengers(ctx, id);
  });

  // دکمه «🚕 سوار می‌شوم» در منوی حمل‌ونقل
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

  // دستور متنی: «سوار ماشین بشم» برای راحتی
  bot.hears(/سوار.?ماشین.?بشم/i, async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await showRideMenu(ctx);
  });

  // وقتی مسافر می‌گوید «درخواست سوار شدن بفرست»
  bot.callbackQuery("ride:req", async (ctx) => {
    try {
      await ctx.answerCallbackQuery();
    } catch (e) {
      console.warn("answerCallbackQuery ride:req failed:", e);
    }
    await handleRideRequest(ctx);
  });

  // راننده قبول/رد می‌کند
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
