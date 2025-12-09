import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";

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

  if (error || !data) {
    console.error("getCharacterByTg error:", error);
    return { char: null as any, errorText: "خطا در خواندن اطلاعات شخصیت." };
  }

  return { char: data, errorText: "" };
}

/**
 * ثبت حرکت وسیله در جدول vehicle_moves
 */
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
    actor_tg_id: actorId,
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
 * تعداد راننده و مسافران یک وسیله
 */
async function getVehicleLoad(
  ctx: MyContext,
  vehicleId: number
): Promise<{ driverId: number | null; passengerIds: number[] }> {
  const { supabase } = ctx.services;

  // راننده
  const { data: drivers, error: dErr } = await supabase
    .from("characters")
    .select("id")
    .eq("riding_vehicle_id", vehicleId);

  if (dErr) {
    console.error("getVehicleLoad driver error:", dErr);
  }

  const driverId =
    drivers && drivers.length > 0 ? (drivers[0].id as number) : null;

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
 * chat_id بانک از bank_settings
 */
async function getBankChatId(ctx: MyContext): Promise<number | null> {
  const { supabase } = ctx.services;

  const { data, error } = await supabase
    .from("bank_settings")
    .select("bank_chat_id")
    .maybeSingle();

  if (error) {
    console.error("getBankChatId error:", error);
    return null;
  }

  return (data?.bank_chat_id as number) ?? null;
}

/**
 * کیبورد منوی اصلی ماشین‌ها/مسافر
 */
function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🚗 ماشین های من", "veh:my")
    .row()
    .text("🚕 مسافر شوم", "ride:menu")
    .row()
    .text("🔙 بازگشت", "ui:home");
}

// نمایش «صفحه» برای ماشین‌ها (با پاک کردن پیام قبلی)
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
    const msg = await ctx.reply(text, { reply_markup: keyboard });
    s.ui_last_message_id = msg.message_id;
  } else {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

/**
 * آیا در این Region/Spot وسیله‌ای هست که ظرفیت سوار شدن داشته باشد؟
 * (راننده دارد + ظرفیت خالی)
 */
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

    // راننده باید سوار باشد (نمی‌گذاریم مسافر بدون راننده ماشین را پر کند)
    if (!driverId) continue;

    const usedSeats = 1 + passengerIds.length; // ۱ راننده + مسافرها
    const freeSeats = (v.capacity ?? 1) - usedSeats;
    if (freeSeats > 0) return true;
  }

  return false;
}

export function registerVehicleTravelFeature(bot: Bot<MyContext>): void {
  //
  // 🧾 ماشین‌های من
  //
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
        "روی یکی از آن‌ها بزن تا جزئیاتش را ببینی.",
      kb
    );
  }

  //
  // 🚕 منوی مسافر شدن
  //
  async function showRideMenu(ctx: MyContext) {
    if (ctx.chat?.type !== "private") return;

    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await sendVehicleScreen(ctx, errorText, mainMenuKeyboard());
      return;
    }

    // اگر خودت راننده‌ی وسیله‌ای هستی
    if (char.riding_vehicle_id) {
      await sendVehicleScreen(
        ctx,
        "الان روی یک وسیله سوار هستی.\n" +
          "اگر مسافر هستی و می‌خواهی پیاده شوی، در پی‌وی بنویس:\n\n" +
          "<code>از ماشین پیاده بشم</code>",
        mainMenuKeyboard()
      );
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

    // آیا اینجا وسیله‌ای هست که بتوانی مسافرش شوی؟
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

    // لیست وسیله‌های حاضر در همین نقطه
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

      // راننده باید سوار باشد (نمی‌گذاریم ماشینِ پارک‌شده بدون راننده مسافر بگیرد)
      if (!driverId) continue;

      // خودت راننده این ماشینی؟ → برو از «ماشین‌های من» استفاده کن
      if (driverId === char.id) continue;

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

  // دکمه «🚕 مسافر شوم» در منوی اصلی
  bot.callbackQuery("ride:menu", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await showRideMenu(ctx);
  });

  //
  // 👂 ماشین های من (متنی که کاربر تایپ می‌کند)
  //
  bot.hears(/ماشین.?های.?من/i, async (ctx) => {
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
      console.error("vehicles hears error:", error);
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
        "هیچ وسیله‌ای برایت ثبت نشده.",
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
        "روی یکی از آن‌ها بزن تا جزئیاتش را ببینی.",
      kb
    );
  });

  //
  // ✅ درخواست سوار شدن به یک وسیله به عنوان مسافر
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

    // نباید الان خودش سوار باشد
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

    // باید در همان نقطه‌ی وسیله باشد
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

    // ظرفیت چک شود
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

    // پیام درخواست برای راننده
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
          `مکان: ${vehicle.current_region_id}/${vehicle.current_spot_id}\n\n` +
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
  // ✅ تایید سوار شدن مسافر توسط راننده
  //
  bot.callbackQuery(/ride:approve:(\d+):(\d+)/, async (ctx) => {
    if (!ctx.from) return;

    const vehicleId = Number(ctx.match![1]);
    const passengerCharId = Number(ctx.match![2]);
    const { supabase } = ctx.services;

    // خود caller را به عنوان راننده لود کن
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

    // چک اینکه واقعاً این راننده، راننده‌ی فعلی این وسیله است
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

    // مسافر نباید خودش روی وسیله‌ی دیگری سوار باشد
    if (passengerChar.riding_vehicle_id) {
      await ctx.answerCallbackQuery({
        text: "این مسافر قبلاً روی وسیله‌ی دیگری سوار شده.",
        show_alert: true,
      });
      return;
    }

    // باید در همان نقطه‌ی وسیله باشد
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

    // ظرفیت
    const usedSeats = 1 + passengerIds.length; // ۱ راننده + بقیه مسافرها
    const freeSeats = (vehicle.capacity ?? 1) - usedSeats;
    if (freeSeats <= 0) {
      await ctx.answerCallbackQuery({
        text: "وسیله دیگر جا ندارد.",
        show_alert: true,
      });
      return;
    }

    // ثبت در vehicle_passengers
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

    // riding_vehicle_id مسافر
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

    // اطلاع به مسافر
    if (passengerChar.tg_id) {
      try {
        await ctx.api.sendMessage(
          passengerChar.tg_id,
          `✅ راننده تو را سوار «${vehicle.title || "وسیله"}» کرد.`,
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
  // ❌ رد درخواست مسافر
  //
  bot.callbackQuery(/ride:reject:(\d+):(\d+)/, async (ctx) => {
    await ctx.answerCallbackQuery({
      text: "درخواست مسافر رد شد.",
      show_alert: true,
    });
  });

  //
  // 🚶 پیاده شدن مسافر از ماشین
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

    // riding_vehicle_id صفر شود
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

    // اگر مسافر ثبت شده بود، از جدول passengers هم حذف شود
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
  // 🚗 شروع سفر رانندگی از روی Edge
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

    // فقط راننده‌ی وسیله اجازه‌ی شروع سفر دارد
    const { driverId } = await getVehicleLoad(ctx, vehicleId);
    if (!driverId || driverId !== char.id) {
      await ctx.answerCallbackQuery({
        text: "فقط راننده‌ی این وسیله می‌تواند سفر را شروع کند.",
        show_alert: true,
      });
      return;
    }

    // TODO: خواندن edge و تنظیم travel برای وسیله + سوخت، مثل پیاده‌روی اما روی vehicle
    await ctx.answerCallbackQuery({
      text: "شروع سفر رانندگی هنوز کامل پیاده نشده 🤖",
      show_alert: true,
    });
  });
}
