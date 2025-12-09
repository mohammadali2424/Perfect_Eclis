import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";

// --- helper: خواندن کاراکتر بر اساس tg_id ---

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

  if (error || !data) {
    console.error("getCharacterByTg error:", error);
    return { char: null as any, errorText: "خطا در خواندن اطلاعات شخصیت." };
  }

  return { char: data, errorText: "" };
}

// --- helper: ثبت حرکت وسیله (اختیاری برای لاگ) ---

async function logVehicleMove(
  ctx: MyContext,
  vehicleId: number,
  fromRegionId: number | null,
  fromSpotId: number | null,
  toRegionId: number | null,
  toSpotId: number | null,
  actorId: number
) {
  const { supabase } = ctx.services;

  const { error } = await supabase.from("vehicle_moves").insert({
    vehicle_id: vehicleId,
    from_region_id: fromRegionId,
    from_spot_id: fromSpotId,
    to_region_id: toRegionId,
    to_spot_id: toSpotId,
    actor_char_id: actorId,
  });

  if (error) {
    console.error("logVehicleMove error:", error);
  }
}

// --- helper: هر ۱٪ سوخت ≈ ۲ دقیقه رانندگی ---

function computeFuelUsagePercent(driveSeconds: number): number {
  if (driveSeconds <= 0) return 0;
  return driveSeconds / 120; // ۲ دقیقه = ۱۲۰ ثانیه
}

// --- ظرفیت وسیله: راننده + مسافران ---

async function getVehicleLoad(
  ctx: MyContext,
  vehicleId: number
): Promise<{ driverId: number | null; passengerIds: number[] }> {
  const { supabase } = ctx.services;

  // راننده: کسی که riding_vehicle_id او روی این وسیله ست شده و owner_char_id هم همین است
  const { data: vehicle, error: vehErr } = await supabase
    .from("vehicles")
    .select("id, owner_char_id")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vehErr || !vehicle) {
    console.error("getVehicleLoad vehicle error:", vehErr);
    return { driverId: null, passengerIds: [] };
  }

  const driverId = vehicle.owner_char_id as number;

  // مسافران
  const { data: passengers, error: pErr } = await supabase
    .from("vehicle_passengers")
    .select("character_id")
    .eq("vehicle_id", vehicleId);

  if (pErr) {
    console.error("getVehicleLoad passenger error:", pErr);
  }

  const passengerIds = (passengers ?? []).map(
    (p: any) => p.character_id as number
  );

  return { driverId, passengerIds };
}

// --- helper: آیا در این مکان وسیله‌ی قابل سوار شدن وجود دارد؟ ---

async function hasBoardableVehicleHere(
  ctx: MyContext,
  regionId: number,
  spotId: number
): Promise<boolean> {
  const { supabase } = ctx.services;

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, capacity, current_region_id, current_spot_id")
    .eq("current_region_id", regionId)
    .eq("current_spot_id", spotId);

  if (error || !vehicles || vehicles.length === 0) return false;

  for (const v of vehicles) {
    const { driverId, passengerIds } = await getVehicleLoad(ctx, v.id);

    if (!driverId) continue; // بدون راننده → سوارشو نمی‌ذاریم
    const usedSeats = 1 + passengerIds.length;
    const freeSeats = (v.capacity ?? 1) - usedSeats;
    if (freeSeats > 0) return true;
  }

  return false;
}

// --- کیبورد منوی اصلی ماشین/مسافر ---

function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🚗 ماشین های من", "veh:my")
    .row()
    .text("🚕 مسافر شوم", "ride:menu")
    .row()
    .text("🏠 منوی اصلی", "ui:home");
}

// --- helper: صفحه‌ی PV ماشین‌ها با پاک کردن پیام قبلی ---

async function sendVehicleScreen(
  ctx: MyContext,
  text: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  if (ctx.chat?.type === "private") {
    const s = ctx.session as any;
    const lastId: number | undefined = s.ui_last_message_id;
    if (lastId) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, lastId);
      } catch {
        // مهم نیست اگر پاک نشد
      }
    }
    const msg = await ctx.reply(text, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
    s.ui_last_message_id = msg.message_id;
  } else {
    await ctx.reply(text, { reply_markup: keyboard, parse_mode: "HTML" });
  }
}

// --- نمایش لیست ماشین‌های من ---

async function showMyVehicles(ctx: MyContext) {
  if (ctx.chat?.type !== "private") return;

  const { supabase } = ctx.services;
  const { char, errorText } = await getCharacterByTg(ctx);

  if (!char) {
    await sendVehicleScreen(ctx, errorText, mainMenuKeyboard());
    return;
  }

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("*")
    .eq("owner_char_id", char.id);

  if (error) {
    console.error("showMyVehicles vehicles error:", error);
    await sendVehicleScreen(
      ctx,
      "در خواندن لیست وسیله‌ها مشکلی پیش آمد.",
      mainMenuKeyboard()
    );
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    await sendVehicleScreen(
      ctx,
      "هیچ وسیله‌ی نقلیه‌ای برایت ثبت نشده.",
      mainMenuKeyboard()
    );
    return;
  }

  const kb = new InlineKeyboard();
  for (const v of vehicles) {
    const title = v.title || `وسیله #${v.id}`;
    kb.text(`🚗 ${title}`, `veh:open:${v.id}`).row();
  }
  kb.text("🔙 بازگشت", "ui:home");

  await sendVehicleScreen(
    ctx,
    "🚗 ماشین‌های ثبت‌شده برایت:\n\n" +
      "روی یکی از آن‌ها بزن تا در آینده جزئیات بیشتری برایش اضافه کنیم.",
    kb
  );
}

// --- منوی "مسافر شوم" ---

async function showRideMenu(ctx: MyContext) {
  if (ctx.chat?.type !== "private") return;

  const { supabase } = ctx.services;
  const { char, errorText } = await getCharacterByTg(ctx);

  if (!char) {
    await sendVehicleScreen(ctx, errorText, mainMenuKeyboard());
    return;
  }

  if (!char.current_region_id || !char.current_spot_id) {
    await sendVehicleScreen(
      ctx,
      "موقعیتت مشخص نیست؛ اول باید در یکی از گروه‌ها ثبت لوکیشن شوی.",
      mainMenuKeyboard()
    );
    return;
  }

  // اگر الان راننده هستی، بهتر است از مسیرهای رانندگی استفاده کنی
  if (char.riding_vehicle_id) {
    await sendVehicleScreen(
      ctx,
      "الان روی یک وسیله‌ی نقلیه هستی.\n" +
        "راننده از «🧭 مسیر های من» مسیر را انتخاب می‌کند.",
      mainMenuKeyboard()
    );
    return;
  }

  const canBoard = await hasBoardableVehicleHere(
    ctx,
    char.current_region_id,
    char.current_spot_id
  );

  if (!canBoard) {
    await sendVehicleScreen(
      ctx,
      "در این نقطه وسیله‌ای برای سوار شدن به عنوان مسافر پیدا نکردم.",
      mainMenuKeyboard()
    );
    return;
  }

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("*")
    .eq("current_region_id", char.current_region_id)
    .eq("current_spot_id", char.current_spot_id);

  if (error || !vehicles || vehicles.length === 0) {
    await sendVehicleScreen(
      ctx,
      "در خواندن لیست وسیله‌ها مشکلی پیش آمد.",
      mainMenuKeyboard()
    );
    return;
  }

  const kb = new InlineKeyboard();
  let anyBoardable = false;

  for (const v of vehicles) {
    const { driverId, passengerIds } = await getVehicleLoad(ctx, v.id);

    if (!driverId) continue; // بدون راننده
    if (driverId === char.id) continue; // خودت راننده‌ای، اینجا دنبال مسافر شدن هستی

    const usedSeats = 1 + passengerIds.length;
    const freeSeats = (v.capacity ?? 1) - usedSeats;
    if (freeSeats <= 0) continue;

    anyBoardable = true;
    const title = v.title || `وسیله #${v.id}`;
    kb.text(`🚕 ${title} (جا: ${freeSeats})`, `ride:req:${v.id}`).row();
  }

  kb.text("🔙 بازگشت", "ui:home");

  if (!anyBoardable) {
    await sendVehicleScreen(
      ctx,
      "در این نقطه وسیله‌ای که ظرفیت خالی داشته باشد پیدا نشد.",
      mainMenuKeyboard()
    );
    return;
  }

  await sendVehicleScreen(
    ctx,
    "یکی از وسیله‌های زیر را برای سوار شدن به عنوان مسافر انتخاب کن:",
    kb
  );
}

// --- رجیستر کردن فیچر سفر با ماشین / مسافر ---

export function registerVehicleTravelFeature(bot: Bot<MyContext>): void {
  //
  // دکمه‌ی "🚗 ماشین های من"
  //
  bot.callbackQuery("veh:my", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await showMyVehicles(ctx);
  });

  //
  // متن "ماشین های من"
  //
  bot.hears(/ماشین.?های.?من/i, async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await showMyVehicles(ctx);
  });

  //
  // دکمه‌ی "🚕 مسافر شوم"
  //
  bot.callbackQuery("ride:menu", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await showRideMenu(ctx);
  });

  //
  // درخواست مسافر شدن روی یک وسیله
  //
  bot.callbackQuery(/ride:req:(\d+)/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }

    const vehicleId = Number(ctx.match![1]);
    const { supabase } = ctx.services;

    const { char, errorText } = await getCharacterByTg(ctx);
    if (!char) {
      await ctx.answerCallbackQuery({ text: errorText, show_alert: true });
      return;
    }

    if (!char.current_region_id || !char.current_spot_id) {
      await ctx.answerCallbackQuery({
        text: "موقعیتت مشخص نیست؛ اول باید در یکی از گروه‌ها ثبت لوکیشن شوی.",
        show_alert: true,
      });
      return;
    }

    if (char.riding_vehicle_id) {
      await ctx.answerCallbackQuery({
        text: "الان خودت روی وسیله‌ای سوار هستی.",
        show_alert: true,
      });
      return;
    }

    const { data: vehicle, error: vErr } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .maybeSingle();

    if (vErr || !vehicle) {
      await ctx.answerCallbackQuery({
        text: "این وسیله دیگر در دسترس نیست.",
        show_alert: true,
      });
      return;
    }

    if (
      vehicle.current_region_id !== char.current_region_id ||
      vehicle.current_spot_id !== char.current_spot_id
    ) {
      await ctx.answerCallbackQuery({
        text: "باید کنار وسیله باشی تا بتوانی درخواست بدهی.",
        show_alert: true,
      });
      return;
    }

    const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicle.id);
    if (!driverId) {
      await ctx.answerCallbackQuery({
        text: "برای این وسیله فعلاً راننده‌ای ثبت نشده.",
        show_alert: true,
      });
      return;
    }

    const usedSeats = 1 + passengerIds.length;
    const freeSeats = (vehicle.capacity ?? 1) - usedSeats;

    if (freeSeats <= 0) {
      await ctx.answerCallbackQuery({
        text: "این وسیله دیگر جا ندارد.",
        show_alert: true,
      });
      return;
    }

    // راننده را پیدا کن
    const { data: driverChar, error: dcErr } = await supabase
      .from("characters")
      .select("*")
      .eq("id", driverId)
      .maybeSingle();

    if (dcErr || !driverChar || !driverChar.tg_id) {
      await ctx.answerCallbackQuery({
        text: "راننده در دسترس نیست.",
        show_alert: true,
      });
      return;
    }

    const passengerName = char.char_name || char.tg_id?.toString() || "مسافر";

    const kb = new InlineKeyboard()
      .text("✅ قبول", `ride:approve:${vehicle.id}:${char.id}`)
      .row()
      .text("❌ رد", `ride:reject:${vehicle.id}:${char.id}`);

    try {
      await ctx.api.sendMessage(
        driverChar.tg_id,
        `🚕 درخواست مسافر\n\n` +
          `مسافر: ${passengerName}\n` +
          `وسیله: ${vehicle.title}\n` +
          `مکان فعلی: Region ${vehicle.current_region_id} / Spot ${vehicle.current_spot_id}\n\n` +
          `می‌خواهی سوارش کنی؟`,
        { reply_markup: kb }
      );
    } catch (e) {
      console.error("ride:req notify driver error:", e);
      await ctx.answerCallbackQuery({
        text: "نتوانستم درخواست را به راننده بفرستم.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({
      text: "درخواستت برای راننده ارسال شد.",
      show_alert: true,
    });

    await sendVehicleScreen(
      ctx,
      "درخواست مسافر شدن ارسال شد.\n" +
        "منتظر بمان تا راننده قبول یا رد کند.",
      mainMenuKeyboard()
    );
  });

  //
  // قبول کردن مسافر توسط راننده
  //
  bot.callbackQuery(/ride:approve:(\d+):(\d+)/, async (ctx) => {
    if (!ctx.from) return;

    const vehicleId = Number(ctx.match![1]);
    const passengerCharId = Number(ctx.match![2]);
    const { supabase } = ctx.services;

    const { data: driverChar, error: dErr } = await supabase
      .from("characters")
      .select("*")
      .eq("tg_id", ctx.from.id)
      .maybeSingle();

    if (dErr || !driverChar) {
      await ctx.answerCallbackQuery({
        text: "راننده پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    const { data: vehicle, error: vErr } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .maybeSingle();

    if (vErr || !vehicle) {
      await ctx.answerCallbackQuery({
        text: "وسیله دیگر در دسترس نیست.",
        show_alert: true,
      });
      return;
    }

    const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicle.id);
    if (!driverId || driverId !== driverChar.id) {
      await ctx.answerCallbackQuery({
        text: "فقط راننده‌ی فعلی وسیله می‌تواند مسافر را سوار کند.",
        show_alert: true,
      });
      return;
    }

    const { data: passengerChar, error: pErr } = await supabase
      .from("characters")
      .select("*")
      .eq("id", passengerCharId)
      .maybeSingle();

    if (pErr || !passengerChar) {
      await ctx.answerCallbackQuery({
        text: "مسافر دیگر در دسترس نیست.",
        show_alert: true,
      });
      return;
    }

    if (passengerChar.riding_vehicle_id) {
      await ctx.answerCallbackQuery({
        text: "این مسافر قبلاً روی وسیله‌ی دیگری سوار شده.",
        show_alert: true,
      });
      return;
    }

    if (
      passengerChar.current_region_id !== vehicle.current_region_id ||
      passengerChar.current_spot_id !== vehicle.current_spot_id
    ) {
      await ctx.answerCallbackQuery({
        text: "مسافر دیگر کنار وسیله نیست.",
        show_alert: true,
      });
      return;
    }

    const usedSeats = 1 + passengerIds.length;
    const freeSeats = (vehicle.capacity ?? 1) - usedSeats;
    if (freeSeats <= 0) {
      await ctx.answerCallbackQuery({
        text: "وسیله دیگر جا ندارد.",
        show_alert: true,
      });
      return;
    }

    const { error: insErr } = await supabase
      .from("vehicle_passengers")
      .insert({
        vehicle_id: vehicle.id,
        character_id: passengerChar.id,
      });

    if (insErr) {
      console.error("ride:approve insert passenger error:", insErr);
      await ctx.answerCallbackQuery({
        text: "در سوار کردن مسافر مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    const { error: updErr } = await supabase
      .from("characters")
      .update({
        riding_vehicle_id: vehicle.id,
      })
      .eq("id", passengerChar.id);

    if (updErr) {
      console.error("ride:approve update passenger error:", updErr);
      await ctx.answerCallbackQuery({
        text: "در سوار کردن مسافر مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    if (passengerChar.tg_id) {
      try {
        await ctx.api.sendMessage(
          passengerChar.tg_id,
          `✅ راننده تو را سوار «${vehicle.title || "وسیله"}» کرد.`
        );
      } catch (e) {
        console.error("notify passenger approve error:", e);
      }
    }

    await ctx.answerCallbackQuery({
      text: "مسافر با موفقیت سوار شد.",
      show_alert: true,
    });
  });

  //
  // رد کردن درخواست مسافر
  //
  bot.callbackQuery(/ride:reject:(\d+):(\d+)/, async (ctx) => {
    await ctx.answerCallbackQuery({
      text: "درخواست مسافر رد شد.",
      show_alert: true,
    });
  });

  //
  // پیاده شدن مسافر از ماشین
  //
  bot.hears(/از ماشین پیاده بشم/i, async (ctx) => {
    if (ctx.chat?.type !== "private") return;

    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await sendVehicleScreen(ctx, errorText, mainMenuKeyboard());
      return;
    }

    if (!char.riding_vehicle_id) {
      await sendVehicleScreen(
        ctx,
        "الان روی هیچ وسیله‌ای سوار نیستی.",
        mainMenuKeyboard()
      );
      return;
    }

    const vehicleId = char.riding_vehicle_id;

    const { error: updErr } = await supabase
      .from("characters")
      .update({
        riding_vehicle_id: null,
      })
      .eq("id", char.id);

    if (updErr) {
      console.error("ride:leave update error:", updErr);
      await sendVehicleScreen(
        ctx,
        "در پیاده شدن مشکلی پیش آمد.",
        mainMenuKeyboard()
      );
      return;
    }

    const { error: delErr } = await supabase
      .from("vehicle_passengers")
      .delete()
      .eq("vehicle_id", vehicleId)
      .eq("character_id", char.id);

    if (delErr) {
      console.error("ride:leave passenger delete error:", delErr);
    }

    await sendVehicleScreen(
      ctx,
      "🚶 به عنوان مسافر از ماشین پیاده شدی.",
      mainMenuKeyboard()
    );
  });

  //
  // شروع سفر رانندگی از روی Edge: veh:go:edgeId:vehicleId
  //
  bot.callbackQuery(/veh:go:(\d+):(\d+)/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }

    const edgeId = Number(ctx.match![1]);
    const vehicleId = Number(ctx.match![2]);

    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.answerCallbackQuery({ text: errorText, show_alert: true });
      return;
    }

    if (!char.current_region_id || !char.current_spot_id) {
      await ctx.answerCallbackQuery({
        text: "لوکیشنت مشخص نیست؛ اول در یک گروه ثبت شو.",
        show_alert: true,
      });
      return;
    }

    const { data: vehicle, error: vErr } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .maybeSingle();

    if (vErr || !vehicle) {
      await ctx.answerCallbackQuery({
        text: "وسیله پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicleId);
    if (!driverId || driverId !== char.id) {
      await ctx.answerCallbackQuery({
        text: "فقط راننده‌ی این وسیله می‌تواند سفر را شروع کند.",
        show_alert: true,
      });
      return;
    }

    const { data: edge, error: eErr } = await supabase
      .from("edges")
      .select("id, from_spot_id, to_spot_id, travel_seconds, drive_seconds")
      .eq("id", edgeId)
      .maybeSingle();

    if (eErr || !edge) {
      await ctx.answerCallbackQuery({
        text: "این مسیر دیگر در دسترس نیست.",
        show_alert: true,
      });
      return;
    }

    if (edge.from_spot_id !== char.current_spot_id) {
      await ctx.answerCallbackQuery({
        text: "از این نقطه نمی‌توانی وارد این مسیر شوی.",
        show_alert: true,
      });
      return;
    }

    const { data: destSpot, error: dsErr } = await supabase
      .from("spots")
      .select("id, region_id, title")
      .eq("id", edge.to_spot_id)
      .maybeSingle();

    if (dsErr || !destSpot) {
      await ctx.answerCallbackQuery({
        text: "نقطه‌ی مقصد پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    const { data: destRegion, error: drErr } = await supabase
      .from("regions")
      .select("id, title")
      .eq("id", destSpot.region_id)
      .maybeSingle();

    if (drErr || !destRegion) {
      await ctx.answerCallbackQuery({
        text: "منطقه‌ی مقصد پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    const driveSeconds =
      edge.drive_seconds ?? edge.travel_seconds ?? 0;

    if (driveSeconds <= 0) {
      await ctx.answerCallbackQuery({
        text: "زمان این مسیر درست تنظیم نشده.",
        show_alert: true,
      });
      return;
    }

    const now = new Date();
    const readyAt = new Date(now.getTime() + driveSeconds * 1000);

    const fuelPercent = vehicle.fuel_percent ?? 0;
    const fuelUse = computeFuelUsagePercent(driveSeconds);

    if (fuelPercent < fuelUse) {
      await ctx.answerCallbackQuery({
        text: "سوخت این وسیله برای این مسیر کافی نیست.",
        show_alert: true,
      });
      return;
    }

    const newFuel = fuelPercent - fuelUse;

    // آپدیت وسیله: جابه‌جایی و سوخت
    const { error: updVehErr } = await supabase
      .from("vehicles")
      .update({
        current_region_id: destSpot.region_id,
        current_spot_id: destSpot.id,
        fuel_percent: newFuel,
      })
      .eq("id", vehicle.id);

    if (updVehErr) {
      console.error("veh:go update vehicle error:", updVehErr);
      await ctx.answerCallbackQuery({
        text: "در شروع حرکت وسیله مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    // راننده + مسافران
    const allCharIds = [char.id, ...passengerIds];

    const { error: updCharsErr } = await supabase
      .from("characters")
      .update({
        pending_region_id: destSpot.region_id,
        pending_spot_id: destSpot.id,
        travel_started_at: now.toISOString(),
        travel_ready_at: readyAt.toISOString(),
        travel_total_seconds: driveSeconds,
        last_move_at: now.toISOString(),
      })
      .in("id", allCharIds);

    if (updCharsErr) {
      console.error("veh:go update chars error:", updCharsErr);
      await ctx.answerCallbackQuery({
        text: "در شروع سفر رانندگی مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    await logVehicleMove(
      ctx,
      vehicle.id,
      vehicle.current_region_id,
      vehicle.current_spot_id,
      destSpot.region_id,
      destSpot.id,
      char.id
    );

    await ctx.answerCallbackQuery({
      text: "سفر رانندگی آغاز شد.",
      show_alert: false,
    });

    // پیام برای راننده
    const kb = new InlineKeyboard()
      .text("🚗 رسیدم؟", "travel:arrive")
      .row()
      .text("🏠 منوی اصلی", "ui:home");

    await sendVehicleScreen(
      ctx,
      `🚗 در حال حرکت با «${vehicle.title || "وسیله"}» به سمت «${
        destRegion.title
      } / ${destSpot.title}» هستی.\n` +
        `زمان تقریبی سفر: ${driveSeconds} ثانیه.\n\n` +
        "هر وقت فکر کردی زمانش گذشته، روی «رسیدم؟» بزن یا /arrive را بفرست.",
      kb
    );

    // پیام برای مسافران (اگر tg_id دارند)
    if (passengerIds.length > 0) {
      const { data: passengerChars, error: pcErr } = await supabase
        .from("characters")
        .select("id, tg_id, char_name")
        .in("id", passengerIds);

      if (!pcErr && passengerChars && passengerChars.length > 0) {
        for (const p of passengerChars) {
          if (!p.tg_id) continue;
          try {
            await ctx.api.sendMessage(
              p.tg_id as number,
              `🚕 وسیله‌ای که سوارش هستی به سمت «${
                destRegion.title
              } / ${destSpot.title}» در حرکت است.\n` +
                `زمان تقریبی سفر: ${driveSeconds} ثانیه.\n` +
                "وقتی راننده رسید، با /arrive یا دکمه‌ی «رسیدم؟» به مقصد می‌رسی."
            );
          } catch (e) {
            console.error("notify passenger veh:go error:", e);
          }
        }
      }
    }
  });
}
