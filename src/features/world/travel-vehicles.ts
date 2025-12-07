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

  if (error) {
    console.error("getCharacterByTg error:", error);
    return {
      char: null as any,
      errorText: "در خواندن اطلاعات کاراکتر مشکلی پیش آمد.",
    };
  }

  if (!data) {
    return {
      char: null as any,
      errorText:
        "هنوز در اکلیس کاراکتری برایت ثبت نشده.\n" +
        "اول باید با «ثبت من» و تایید ارباب وارد جهان شوی.",
    };
  }

  if (!data.is_approved) {
    return {
      char: null as any,
      errorText:
        "درخواست ورودت به اکلیس هنوز توسط ارباب تایید نشده است.\n" +
        "بعد از تایید، می‌توانی از ماشین‌ها و مسیرها استفاده کنی.",
    };
  }

  return { char: data, errorText: null as string | null };
}

/**
 * منوی اصلی پی‌وی (برای برگشت به حالت عادی)
 */
function mainMenuKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("🧭 مسیر های من", "paths:open")
    .row()
    .text("🗺 نقشه سریع من", "mymap:open");
  return kb;
}

/**
 * ارسال «صفحه» در پی‌وی با حذف پیام قبلی
 */
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
 * لاگ حرکت وسیله
 */
async function logVehicleMove(
  ctx: MyContext,
  vehicleId: number,
  fromSpotId: number | null,
  toSpotId: number | null,
  mode: "drive" | "tow" | "other"
) {
  const { supabase } = ctx.services;
  const actorId = ctx.from?.id ?? null;

  const { error } = await supabase.from("vehicle_moves").insert({
    vehicle_id: vehicleId,
    from_spot_id: fromSpotId,
    to_spot_id: toSpotId,
    mode,
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
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("getBankChatId error:", error);
    return null;
  }
  return data?.bank_chat_id ?? null;
}

/**
 * قیمت پایه فلوکس (به ازای هر ۱٪)
 */
async function getGlobalFluxPrice(ctx: MyContext): Promise<number> {
  const { supabase } = ctx.services;
  const { data, error } = await supabase
    .from("flux_global_config")
    .select("base_price_per_percent")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("getGlobalFluxPrice error:", error);
    return 1;
  }
  return data?.base_price_per_percent ?? 1;
}

/**
 * تنظیمات Spot برای فلوکس
 */
async function getSpotFluxConfig(
  ctx: MyContext,
  spotId: number
): Promise<{ multiplier: number; is_flux_spot: boolean }> {
  const { supabase } = ctx.services;
  const { data, error } = await supabase
    .from("spots")
    .select("flux_price_multiplier, is_flux_spot")
    .eq("id", spotId)
    .maybeSingle();

  if (error) {
    console.error("getSpotFluxConfig error:", error);
    return { multiplier: 1, is_flux_spot: false };
  }

  return {
    multiplier: data?.flux_price_multiplier ?? 1,
    is_flux_spot: data?.is_flux_spot ?? false,
  };
}

/**
 * ساخت session برای سوخت‌گیری در یک Spot (حداکثر ۲ پمپ فعال)
 */
async function createFluxSession(
  ctx: MyContext,
  spotId: number,
  vehicleId: number,
  charId: number
): Promise<number | null | "error"> {
  const { supabase } = ctx.services;

  // sessionهای active این Spot
  const { data: activeSessions, error: countErr } = await supabase
    .from("flux_sessions")
    .select("id")
    .eq("spot_id", spotId)
    .eq("state", "active");

  if (countErr) {
    console.error("createFluxSession count error:", countErr);
    return "error"; // 👈 خطای فنی در شمارش
  }

  const activeCount = activeSessions?.length ?? 0;

  // حداکثر ۲ پمپ در هر Spot
  if (activeCount >= 2) {
    return null; // 👈 این یکی یعنی واقعا پمپ‌ها پرن
  }

  // اینجا باید همه ستون‌های not-null را پر کنیم: spot_id, vehicle_id, char_id, mode, state
  const { data, error } = await supabase
    .from("flux_sessions")
    .insert({
      spot_id: spotId,
      vehicle_id: vehicleId,
      char_id: charId,
      mode: "fuel",
      state: "active",
    })
    .select("id")
    .single();

  if (error) {
    console.error("createFluxSession insert error:", error);
    return "error"; // 👈 اینم خطای فنی (مثل همین constraint ها)
  }

  return data.id as number;
}


/**
 * آپدیت وضعیت session سوخت‌گیری
 */
async function finishFluxSession(
  ctx: MyContext,
  sessionId: number,
  newState: "done" | "cancelled"
) {
  const { supabase } = ctx.services;
  const { error } = await supabase
    .from("flux_sessions")
    .update({ state: newState })
    .eq("id", sessionId);

  if (error) {
    console.error("finishFluxSession error:", error);
  }
}

/**
 * لاگ پرداخت فلوکس
 */
async function createFluxPaymentLog(
  ctx: MyContext,
  charId: number,
  vehicleId: number,
  sessionId: number | null,
  amountPercent: number,
  totalCost: number
) {
  const { supabase } = ctx.services;
  const { error } = await supabase.from("flux_payments").insert({
    character_id: charId,
    vehicle_id: vehicleId,
    flux_session_id: sessionId,
    amount_percent: amountPercent,
    total_cost: totalCost,
  });

  if (error) {
    console.error("createFluxPaymentLog error:", error);
  }
}

/**
 * وضعیت ویزارد سوخت‌گیری داخل session
 */
interface FuelWizardState {
  spotId: number;
  vehicleId: number;
  maxPercent: number;
  pricePerPercent: number;
  requestedPercent?: number;
  totalCost?: number;
  sessionId?: number;
}

export function registerVehicleTravelFeature(bot: Bot<MyContext>): void {
  //
  // 🏁 «ماشین های من»
  //
   async function showRideMenu(ctx: MyContext) {
    if (ctx.chat?.type !== "private") return;

    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await sendVehicleScreen(ctx, errorText || "کاراکترت نامشخص است.");
      return;
    }

    if (!char.is_approved) {
      await sendVehicleScreen(
        ctx,
        "درخواست ورودت به اکلیس هنوز توسط ارباب تایید نشده.\n" +
          "بعد از تایید، می‌توانی از ماشین‌ها و مسیرها استفاده کنی.",
        mainMenuKeyboard()
      );
      return;
    }

    if (char.current_region_id == null || char.current_spot_id == null) {
      await sendVehicleScreen(
        ctx,
        "هنوز در هیچ مکانی ثبت نشده‌ای.\n" +
          "اول ارباب باید با «ثبت پلیر» تو را وارد یکی از Regionها کند.",
        mainMenuKeyboard()
      );
      return;
    }

    // اگر همین الان روی وسیله‌ای هستی
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

    // اگر قبلاً به عنوان مسافر ثبت شده‌ای (به هر دلیل)
    if (await isCharacterPassenger(ctx, char.id)) {
      await sendVehicleScreen(
        ctx,
        "در سیستم به عنوان مسافر ثبت شده‌ای.\n" +
          "اگر فکر می‌کنی اشتباه است، به ارباب اطلاع بده.",
        mainMenuKeyboard()
      );
      return;
    }

    // ماشین‌هایی که همین‌جا پارک‌اند
    const { data: vehicles, error } = await supabase
      .from("vehicles")
      .select(
        "id, title, type, capacity, current_region_id, current_spot_id, owner_char_id"
      )
      .eq("current_region_id", char.current_region_id)
      .eq("current_spot_id", char.current_spot_id);

    if (error) {
      console.error("ride:menu load vehicles error:", error);
      await sendVehicleScreen(
        ctx,
        "در خواندن وسایل نقلیه‌ی این مکان مشکلی پیش آمد.",
        mainMenuKeyboard()
      );
      return;
    }

    if (!vehicles || vehicles.length === 0) {
      await sendVehicleScreen(
        ctx,
        "در این مکان هیچ وسیله‌ای پارک نشده که بتوانی سوارش شوی.",
        mainMenuKeyboard()
      );
      return;
    }

    const available: { id: number; title: string; freeSeats: number }[] = [];

    for (const v of vehicles) {
      const { driverId, passengerIds } = await getVehicleLoad(ctx, v.id);

      // راننده باید سوار باشد (نمی‌گذاریم مسافر بدون راننده ماشین را پر کند)
      if (!driverId) continue;

      // خودت راننده این ماشینی؟ برو از «ماشین های من» استفاده کن
      if (driverId === char.id) continue;

      const usedSeats = 1 + passengerIds.length; // ۱ راننده + مسافرها
      const freeSeats = (v.capacity ?? 1) - usedSeats;

      if (freeSeats <= 0) continue;

      available.push({
        id: v.id,
        title: v.title,
        freeSeats,
      });
    }

    if (available.length === 0) {
      await sendVehicleScreen(
        ctx,
        "در این مکان وسیله‌ای که جای خالی برای مسافر داشته باشد پیدا نشد.",
        mainMenuKeyboard()
      );
      return;
    }

    const kb = new InlineKeyboard();
    for (const v of available) {
      kb.text(
        `سوار ${v.title} (جای خالی: ${v.freeSeats})`,
        `ride:req:${v.id}`
      ).row();
    }
    kb.text("🏠 منوی اصلی", "ui:home");

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

  // دستور متنی: «سوار ماشین بشم»
  bot.hears(/سوار.?ماشین.?بشم/i, async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await showRideMenu(ctx);
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
      await ctx.answerCallbackQuery({
        text: errorText || "کاراکترت نامشخص است.",
        show_alert: true,
      });
      return;
    }

    if (!char.is_approved) {
      await ctx.answerCallbackQuery({
        text: "هنوز ورودت به اکلیس تایید نشده.",
        show_alert: true,
      });
      return;
    }

    if (char.current_region_id == null || char.current_spot_id == null) {
      await ctx.answerCallbackQuery({
        text: "هنوز در هیچ مکانی ثبت نشده‌ای.",
        show_alert: true,
      });
      return;
    }

    if (char.riding_vehicle_id) {
      await ctx.answerCallbackQuery({
        text: "الان روی یک وسیله سوار هستی.",
        show_alert: true,
      });
      return;
    }

    if (await isCharacterPassenger(ctx, char.id)) {
      await ctx.answerCallbackQuery({
        text: "در سیستم به عنوان مسافر ثبت شده‌ای.",
        show_alert: true,
      });
      return;
    }

    const { data: vehicle, error } = await supabase
      .from("vehicles")
      .select(
        "id, title, type, capacity, current_region_id, current_spot_id, owner_char_id"
      )
      .eq("id", vehicleId)
      .maybeSingle();

    if (error || !vehicle) {
      console.error("ride:req load vehicle error:", error);
      await ctx.answerCallbackQuery({
        text: "این وسیله پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    // باید در همان مکان باشی که ماشین هست
    if (
      vehicle.current_region_id == null ||
      vehicle.current_spot_id == null ||
      vehicle.current_region_id !== char.current_region_id ||
      vehicle.current_spot_id !== char.current_spot_id
    ) {
      await ctx.answerCallbackQuery({
        text: "برای سوار شدن باید کنار همان وسیله باشی.",
        show_alert: true,
      });
      return;
    }

    const { driverId, passengerIds } = await getVehicleLoad(ctx, vehicle.id);
    const usedSeats = (driverId ? 1 : 0) + passengerIds.length;
    const freeSeats = (vehicle.capacity ?? 1) - usedSeats;

    if (freeSeats <= 0) {
      await ctx.answerCallbackQuery({
        text: "این وسیله دیگر جایی برای مسافر ندارد.",
        show_alert: true,
      });
      return;
    }

    // ثبت به عنوان مسافر
    const { error: insErr } = await supabase
      .from("vehicle_passengers")
      .insert({
        vehicle_id: vehicle.id,
        character_id: char.id,
      });

    if (insErr) {
      console.error("ride:req insert passenger error:", insErr);
      await ctx.answerCallbackQuery({
        text: "در سوار شدن به عنوان مسافر مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    const { error: updErr } = await supabase
      .from("characters")
      .update({ riding_vehicle_id: vehicle.id })
      .eq("id", char.id);

    if (updErr) {
      console.error("ride:req update character error:", updErr);
      await ctx.answerCallbackQuery({
        text: "در ثبت وضعیت سوار شدن مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({
      text: `به عنوان مسافر سوار ${vehicle.title} شدی.`,
      show_alert: false,
    });

    await sendVehicleScreen(
      ctx,
      `به عنوان مسافر سوار ${vehicle.title} شدی.\n` +
        "راننده با «🛣 مسیرهای رانندگی» حرکت می‌کند.\n" +
        "وقتی به مقصد رسیدید، با «رسیدم؟» تو هم به مقصد می‌رسی.",
      mainMenuKeyboard()
    );

    // اطلاع دادن به راننده (اگر بتوانیم)
    if (driverId) {
      const { data: driverChar, error: dErr } = await supabase
        .from("characters")
        .select("tg_id")
        .eq("id", driverId)
        .maybeSingle();

      if (!dErr && driverChar?.tg_id) {
        try {
          await ctx.api.sendMessage(
            driverChar.tg_id,
            `🧍 یک مسافر جدید سوار ${vehicle.title} شد.\n` +
              `نام: ${char.char_name ?? ctx.from?.first_name ?? "یک مسافر"}`
          );
        } catch (e) {
          console.error("notify driver passenger boarded error:", e);
        }
      }
    }
  });


  
  bot.hears(/ماشین.?های.?من/i, async (ctx) => {
    if (ctx.chat?.type !== "private") return;

    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await sendVehicleScreen(ctx, errorText!);
      return;
    }

    const { data: vehicles, error } = await supabase
      .from("vehicles")
      .select(
        "id, title, type, capacity, fuel_percent, current_region_id, current_spot_id"
      )
      .eq("owner_char_id", char.id);

    if (error) {
      console.error("list my vehicles error:", error);
      await sendVehicleScreen(ctx, "در خواندن وسایل نقلیه مشکلی پیش آمد.");
      return;
    }

    if (!vehicles || vehicles.length === 0) {
      await sendVehicleScreen(
        ctx,
        "هنوز هیچ وسیله‌ای در جهان اکلیس برایت ثبت نشده.\n" +
          "از طریق گروه شاپ، می‌توانند وسیله برایت ثبت کنند."
      );
      return;
    }

    const lines: string[] = [];
    const kb = new InlineKeyboard();

    for (const v of vehicles) {
      const loc =
        v.current_region_id && v.current_spot_id
          ? `Region#${v.current_region_id} / Spot#${v.current_spot_id}`
          : "مکان: نامشخص";

      lines.push(
        `• [${v.id}] ${v.title} (${v.type}) – ظرفیت: ${v.capacity} – سوخت: ${v.fuel_percent}% – ${loc}`
      );

      kb.text(`سوار ${v.title}`, `veh:board:${v.id}`).row();
    }

    await sendVehicleScreen(
      ctx,
      "🚗 وسایل نقلیه‌ی تو در اکلیس:\n\n" + lines.join("\n"),
      kb
    );
  });

  //
  // 🚗 سوار شدن روی وسیله
  //
  bot.callbackQuery(/veh:board:(\d+)/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }

    const vehicleId = Number(ctx.match![1]);
    const { supabase } = ctx.services;

    const { char, errorText } = await getCharacterByTg(ctx);
    if (!char) {
      await ctx.answerCallbackQuery({
        text: errorText || "کاراکترت نامشخص است.",
        show_alert: true,
      });
      return;
    }

    const { data: vehicle, error } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .maybeSingle();

    if (error || !vehicle) {
      console.error("veh:board load vehicle error:", error);
      await ctx.answerCallbackQuery({
        text: "این وسیله پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    if (vehicle.owner_char_id !== char.id) {
      await ctx.answerCallbackQuery({
        text: "این وسیله متعلق به کاراکتر دیگری است.",
        show_alert: true,
      });
      return;
    }

    // اگر همین الان سوار همین وسیله هستی
    if (char.riding_vehicle_id === vehicle.id) {
      const kb = new InlineKeyboard()
        .text("🛣 مسیرهای رانندگی", `veh:paths:${vehicle.id}`)
        .row()
        .text("⛽ سوخت‌گیری", `veh:fuel:${vehicle.id}`)
        .row()
        .text("🚶 پیاده شو", `veh:leave:${vehicle.id}`);

      await ctx.answerCallbackQuery();
      await sendVehicleScreen(
        ctx,
        `هنوز سوار ${vehicle.title} هستی.\nسوخت فعلی: ${vehicle.fuel_percent}%`,
        kb
      );
      return;
    }

    // باید در همان Region/Spot وسیله باشی
    if (
      char.current_region_id == null ||
      char.current_spot_id == null ||
      vehicle.current_region_id == null ||
      vehicle.current_spot_id == null ||
      char.current_region_id !== vehicle.current_region_id ||
      char.current_spot_id !== vehicle.current_spot_id
    ) {
      await ctx.answerCallbackQuery({
        text: "برای سوار شدن باید در همان مکان وسیله باشی.",
        show_alert: true,
      });
      return;
    }

    // اگر سوار وسیله‌ی دیگری است
    if (char.riding_vehicle_id && char.riding_vehicle_id !== vehicle.id) {
      await ctx.answerCallbackQuery({
        text: "الان سوار یک وسیله‌ی دیگر هستی. اول از آن پیاده شو.",
        show_alert: true,
      });
      return;
    }

    const { error: updErr } = await supabase
      .from("characters")
      .update({ riding_vehicle_id: vehicle.id })
      .eq("id", char.id);

    if (updErr) {
      console.error("set riding_vehicle_id error:", updErr);
      await ctx.answerCallbackQuery({
        text: "در سوار شدن مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();

    const kb = new InlineKeyboard()
      .text("🛣 مسیرهای رانندگی", `veh:paths:${vehicle.id}`)
      .row()
      .text("⛽ سوخت‌گیری", `veh:fuel:${vehicle.id}`)
      .row()
      .text("🚶 پیاده شو", `veh:leave:${vehicle.id}`);

    await sendVehicleScreen(
      ctx,
      `سوار ${vehicle.title} شدی.\n` +
        `نوع: ${vehicle.type}\n` +
        `سوخت فعلی: ${vehicle.fuel_percent}%`,
      kb
    );
  });

  //
  // 🚶 پیاده شدن از وسیله
  //
  bot.callbackQuery(/veh:leave:(\d+)/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }

    const vehicleId = Number(ctx.match![1]);
    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.answerCallbackQuery({
        text: errorText || "کاراکترت نامشخص است.",
        show_alert: true,
      });
      return;
    }

    if (char.riding_vehicle_id !== vehicleId) {
      await ctx.answerCallbackQuery({
        text: "الان روی این وسیله سوار نیستی.",
        show_alert: true,
      });
      return;
    }

    const { error: updErr } = await supabase
      .from("characters")
      .update({ riding_vehicle_id: null })
      .eq("id", char.id);

    if (updErr) {
      console.error("veh:leave update error:", updErr);
      await ctx.answerCallbackQuery({
        text: "در پیاده شدن مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({
      text: "پیاده شدی.",
      show_alert: false,
    });

    await sendVehicleScreen(
      ctx,
      "🚶 از وسیله پیاده شدی.",
      mainMenuKeyboard()
    );
  });

  //
  // 🛣 مسیرهای رانندگی از Spot فعلی
  //
  bot.callbackQuery(/veh:paths:(\d+)/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    const vehicleId = Number(ctx.match![1]);
    const { supabase } = ctx.services;

    const { char, errorText } = await getCharacterByTg(ctx);
    if (!char) {
      await ctx.answerCallbackQuery({
        text: errorText || "کاراکترت نامشخص است.",
        show_alert: true,
      });
      return;
    }

    if (char.riding_vehicle_id !== vehicleId) {
      await ctx.answerCallbackQuery({
        text: "برای دیدن مسیرهای رانندگی، باید روی این وسیله سوار باشی.",
        show_alert: true,
      });
      return;
    }

    if (!char.current_spot_id) {
      await ctx.answerCallbackQuery({
        text: "مکان فعلی‌ات نامشخص است.",
        show_alert: true,
      });
      return;
    }

    const { data: edges, error } = await supabase
      .from("edges")
      .select("*")
      .eq("from_spot_id", char.current_spot_id)
      .eq("allow_drive", true)
      .eq("is_locked", false);

    if (error) {
      console.error("veh:paths edges error:", error);
      await ctx.answerCallbackQuery({
        text: "در خواندن مسیرهای رانندگی مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    if (!edges || edges.length === 0) {
      await ctx.answerCallbackQuery({
        text: "در این نقطه، مسیری برای رانندگی تعریف نشده.",
        show_alert: true,
      });
      return;
    }

    const toIds = edges.map((e: any) => e.to_spot_id);
    const { data: spots, error: spotErr } = await supabase
      .from("spots")
      .select("id, title")
      .in("id", toIds);

    if (spotErr || !spots) {
      await ctx.answerCallbackQuery({
        text: "در خواندن مقاصد مسیرها مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    const m = new Map<number, string>();
    for (const s of spots) {
      m.set(s.id, s.title);
    }

    const kb = new InlineKeyboard();
    const lines: string[] = [];

    for (const e of edges) {
      const title = m.get(e.to_spot_id) || `Spot #${e.to_spot_id}`;
      const seconds = e.drive_seconds ?? e.travel_seconds ?? 0;
      lines.push(`• ${title} ~ ${seconds}ث`);
      kb.text(`➤ ${title}`, `veh:go:${vehicleId}:${e.id}`).row();
    }

    await ctx.answerCallbackQuery();

    await sendVehicleScreen(
      ctx,
      "🛣 مسیرهای رانندگی از جایگاه فعلی:\n\n" + lines.join("\n"),
      kb
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

    const vehicleId = Number(ctx.match![1]);
    const edgeId = Number(ctx.match![2]);
    const { supabase } = ctx.services;

    const { char, errorText } = await getCharacterByTg(ctx);
    if (!char) {
      await ctx.answerCallbackQuery({
        text: errorText || "کاراکترت نامشخص است.",
        show_alert: true,
      });
      return;
    }

    if (char.riding_vehicle_id !== vehicleId) {
      await ctx.answerCallbackQuery({
        text: "برای حرکت با این مسیر، باید سوار همان وسیله باشی.",
        show_alert: true,
      });
      return;
    }

    if (!char.current_spot_id) {
      await ctx.answerCallbackQuery({
        text: "مکان فعلی‌ات نامشخص است.",
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
        text: "خود وسیله در دیتابیس پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    const { data: edge, error: eErr } = await supabase
      .from("edges")
      .select("*")
      .eq("id", edgeId)
      .maybeSingle();

    if (eErr || !edge) {
      await ctx.answerCallbackQuery({
        text: "این مسیر دیگر وجود ندارد.",
        show_alert: true,
      });
      return;
    }

    if (!edge.allow_drive || edge.is_locked) {
      await ctx.answerCallbackQuery({
        text: "این مسیر دیگر برای رانندگی فعال نیست.",
        show_alert: true,
      });
      return;
    }

    const driveSeconds: number =
      edge.drive_seconds ?? Math.floor((edge.travel_seconds ?? 0) * 0.5);
    const fuelNeededPercent = computeFuelUsagePercent(driveSeconds);

    if (vehicle.fuel_percent <= 0 || vehicle.fuel_percent < fuelNeededPercent) {
      await ctx.answerCallbackQuery({
        text: "سوخت این وسیله برای این مسیر کافی نیست.",
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
        text: "نقطه مقصد این مسیر پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    const destRegionId = destSpot.region_id;

    const now = new Date();
    const arrival = new Date(now.getTime() + driveSeconds * 1000);

    const { error: updCharErr } = await supabase
      .from("characters")
      .update({
        pending_region_id: destRegionId,
        pending_spot_id: destSpot.id,
        travel_ready_at: arrival.toISOString(),
        travel_total_seconds: driveSeconds,
        travel_started_at: now.toISOString(),
        last_move_at: now.toISOString(),
      })
      .eq("id", char.id);

        // مسافرهای این وسیله را هم همراه راننده در سفر قرار بده
    const { passengerIds } = await getVehicleLoad(ctx, vehicle.id);

    if (passengerIds.length > 0) {
      const { error: updPassengersErr } = await supabase
        .from("characters")
        .update({
          pending_region_id: destRegionId,
          pending_spot_id: destSpot.id,
          travel_ready_at: arrival.toISOString(),
          travel_total_seconds: driveSeconds,
          travel_started_at: now.toISOString(),
          last_move_at: now.toISOString(),
        })
        .in("id", passengerIds);

      if (updPassengersErr) {
        console.error("veh:go update passengers error:", updPassengersErr);
      }
    }


    if (updCharErr) {
      console.error("veh:go update character error:", updCharErr);
      await ctx.answerCallbackQuery({
        text: "در شروع سفر رانندگی مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    const { error: updVehErr } = await supabase
      .from("vehicles")
      .update({
        fuel_percent: Math.max(
          0,
          vehicle.fuel_percent - fuelNeededPercent
        ),
        current_region_id: destRegionId,
        current_spot_id: destSpot.id,
      })
      .eq("id", vehicle.id);

    if (updVehErr) {
      console.error("veh:go update vehicle fuel error:", updVehErr);
    }

    await logVehicleMove(
      ctx,
      vehicle.id,
      char.current_spot_id,
      edge.to_spot_id,
      "drive"
    );

    await ctx.answerCallbackQuery();

    const kb = new InlineKeyboard()
      .text("رسیدم؟", "travel:arrive")
      .row()
      .text("لغو مسیر", "travel:cancel");

    await sendVehicleScreen(
      ctx,
      "🚗 سفر رانندگی آغاز شد.\n" +
        `زمان تقریبی: ${driveSeconds} ثانیه\n` +
        `سوخت مصرف‌شده: ~${fuelNeededPercent.toFixed(1)}٪\n\n` +
        "وقتی فکر کردی زمانش گذشته، «رسیدم؟» را بزن.\n" +
        "اگر پشیمان شدی، می‌توانی «لغو مسیر» را بفرستی؛ اعتبار زمانی حساب می‌شود.",
      kb
    );
  });

  //
  // ⛽ سوخت‌گیری
  //
  bot.callbackQuery(/veh:fuel:(\d+)/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    const vehicleId = Number(ctx.match![1]);
    const { supabase } = ctx.services;

    const { char, errorText } = await getCharacterByTg(ctx);
    if (!char) {
      await ctx.answerCallbackQuery({
        text: errorText || "کاراکترت نامشخص است.",
        show_alert: true,
      });
      return;
    }

    if (!char.current_spot_id) {
      await ctx.answerCallbackQuery({
        text: "مکان فعلی‌ات نامشخص است.",
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
        text: "وسیله‌ی مورد نظر پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    if (vehicle.owner_char_id !== char.id) {
      await ctx.answerCallbackQuery({
        text: "این وسیله متعلق به کاراکتر دیگری است.",
        show_alert: true,
      });
      return;
    }

    const spotId = char.current_spot_id as number;
    const { multiplier, is_flux_spot } = await getSpotFluxConfig(ctx, spotId);

    if (!is_flux_spot) {
      await ctx.answerCallbackQuery({
        text: "اینجا جایگاه فلوکس نیست.",
        show_alert: true,
      });
      return;
    }

    const bankChatId = await getBankChatId(ctx);
    if (!bankChatId) {
      await ctx.answerCallbackQuery({
        text: "هشدار: گروه بانک هنوز ثبت نشده (ثبت گروه بانک).",
        show_alert: true,
      });
    } else {
      await ctx.answerCallbackQuery();
    }

    const basePrice = await getGlobalFluxPrice(ctx);
    const pricePerPercent = basePrice * multiplier;

    const maxPercent = 100 - (vehicle.fuel_percent ?? 0);
    if (maxPercent <= 0) {
      await sendVehicleScreen(
        ctx,
        `سوخت ${vehicle.title} همین حالا هم کامل است (${vehicle.fuel_percent}%).`
      );
      return;
    }

 const sessionId = await createFluxSession(ctx, spotId, vehicle.id, char.id);

if (sessionId === "error") {
  await sendVehicleScreen(
    ctx,
    "در ساخت نوبت سوخت‌گیری مشکلی فنی پیش آمد.\n" +
      "اگر این خطا تکرار شد، ارباب باید لاگ‌ها و تنظیمات چاه فلوکس را چک کند."
  );
  return;
}

if (sessionId === null) {
  await sendVehicleScreen(
    ctx,
    "⛽ هر دو پمپ این جایگاه در حال استفاده هستند.\n" +
      "باید کمی صبر کنی تا یکی از پمپ‌ها خالی شود."
  );
  return;
}

    (ctx.session as any).fuelWizard = {
      spotId,
      vehicleId: vehicle.id,
      maxPercent,
      pricePerPercent,
      sessionId,
    } as FuelWizardState;

    const text =
      "⛽ جایگاه فلوکس\n" +
      "───────────────\n" +
      `وسیله: ${vehicle.title}\n` +
      `سوخت فعلی: ${vehicle.fuel_percent}%\n` +
      `حداکثر قابل پر شدن: ${maxPercent}%\n` +
      `قیمت پایه هر ۱٪: ${basePrice} سولن\n` +
      `ضریب این جایگاه: x${multiplier}\n` +
      `قیمت نهایی هر ۱٪: ${pricePerPercent} سولن\n` +
      "───────────────\n" +
      "یک عدد بفرست:\n" +
      "چند درصد می‌خواهی پر کنی؟ (مثلاً 10 یعنی ۱۰٪)";

    await sendVehicleScreen(ctx, text);
  });

  //
  // مرحله‌ی گرفتن درصد سوخت از کاربر
  //
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "private") return next();

    const fw = (ctx.session as any).fuelWizard as FuelWizardState | undefined;
    if (!fw) return next();

    const raw = ctx.message.text.trim();
    const n = Number(raw);

    if (!Number.isFinite(n) || n <= 0) {
      await sendVehicleScreen(
        ctx,
        "برای سوخت‌گیری، یک عدد مثبت بفرست (مثلاً 5 یا 12)."
      );
      return;
    }

    const amount = Math.min(n, fw.maxPercent);
    const totalCost = Math.ceil(amount * fw.pricePerPercent);

    fw.requestedPercent = amount;
    fw.totalCost = totalCost;
    (ctx.session as any).fuelWizard = fw;

    const kb = new InlineKeyboard()
      .text("✅ تایید سوخت‌گیری", "veh:fuelconfirm:yes")
      .row()
      .text("❌ لغو", "veh:fuelconfirm:no");

    const text =
      "تایید سوخت‌گیری فلوکس\n" +
      "───────────────\n" +
      `درصد درخواستی: ${amount}%\n` +
      `قیمت هر ۱٪: ${fw.pricePerPercent} سولن\n` +
      `مبلغ نهایی: ${totalCost} سولن\n` +
      "───────────────\n" +
      "اگر تایید می‌کنی، روی «تایید سوخت‌گیری» بزن.";

    await sendVehicleScreen(ctx, text, kb);
  });

  //
  // تایید / لغو نهایی سوخت‌گیری
  //
  bot.callbackQuery(/veh:fuelconfirm:(yes|no)/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }

    const action = ctx.match![1] as "yes" | "no";
    const fw = (ctx.session as any).fuelWizard as FuelWizardState | undefined;

    if (!fw) {
      await ctx.answerCallbackQuery({
        text: "هیچ فرایند سوخت‌گیری فعالی ندارم.",
        show_alert: true,
      });
      return;
    }

    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.answerCallbackQuery({
        text: errorText || "کاراکترت نامشخص است.",
        show_alert: true,
      });
      (ctx.session as any).fuelWizard = undefined;
      return;
    }

    if (action === "no") {
      await ctx.answerCallbackQuery();
      if (fw.sessionId) {
        await finishFluxSession(ctx, fw.sessionId, "cancelled");
      }
      (ctx.session as any).fuelWizard = undefined;
      await sendVehicleScreen(ctx, "سوخت‌گیری لغو شد.", mainMenuKeyboard());
      return;
    }

    // yes
    await ctx.answerCallbackQuery();

    const { data: vehicle, error: vErr } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", fw.vehicleId)
      .maybeSingle();

    if (vErr || !vehicle) {
      await sendVehicleScreen(ctx, "وسیله‌ی مورد نظر دیگر وجود ندارد.");
      if (fw.sessionId) {
        await finishFluxSession(ctx, fw.sessionId, "cancelled");
      }
      (ctx.session as any).fuelWizard = undefined;
      return;
    }

    const bankChatId = await getBankChatId(ctx);

    const currentFuel: number = vehicle.fuel_percent ?? 0;
    const freeCapacity = Math.max(0, 100 - currentFuel);
    const requested = fw.requestedPercent ?? 0;
    const actualPercent = Math.min(requested, freeCapacity);

    if (actualPercent <= 0) {
      await sendVehicleScreen(
        ctx,
        `سوخت ${vehicle.title} در این فاصله پر شده است (${vehicle.fuel_percent}%).`
      );
      if (fw.sessionId) {
        await finishFluxSession(ctx, fw.sessionId, "cancelled");
      }
      (ctx.session as any).fuelWizard = undefined;
      return;
    }

    const totalCost = Math.ceil(actualPercent * fw.pricePerPercent);

    const { error: updErr } = await supabase
      .from("vehicles")
      .update({
        fuel_percent: Math.min(100, currentFuel + actualPercent),
      })
      .eq("id", vehicle.id);

    if (updErr) {
      console.error("update vehicle fuel error:", updErr);
      await sendVehicleScreen(ctx, "در به‌روزرسانی سوخت وسیله مشکلی پیش آمد.");
      if (fw.sessionId) {
        await finishFluxSession(ctx, fw.sessionId, "cancelled");
      }
      (ctx.session as any).fuelWizard = undefined;
      return;
    }

    if (fw.sessionId) {
      await finishFluxSession(ctx, fw.sessionId, "done");
    }

    await createFluxPaymentLog(
      ctx,
      char.id,
      vehicle.id,
      fw.sessionId ?? null,
      actualPercent,
      totalCost
    );

    // ارسال به گروه بانک
    if (bankChatId) {
      try {
        const { data: spot, error: spotErr } = await supabase
          .from("spots")
          .select("title, region_id")
          .eq("id", fw.spotId)
          .maybeSingle();

        let regionTitle = "";
        if (!spotErr && spot?.region_id) {
          const { data: reg } = await supabase
            .from("regions")
            .select("title")
            .eq("id", spot.region_id)
            .maybeSingle();
          regionTitle = reg?.title ?? "";
        }

        const user = ctx.from!;
        const mention =
          user.username
            ? `@${user.username}`
            : `${user.first_name} (${user.id})`;

        const bankText =
          "💸 تراکنش فلوکس\n" +
          "───────────────\n" +
          `کاربر: ${mention}\n` +
          `کاراکتر: ${char.char_name ?? "نامشخص"}\n` +
          `وسیله: ${vehicle.title} (ID: ${vehicle.id})\n` +
          `جایگاه: ${spot?.title ?? "نامشخص"}${
            regionTitle ? " / " + regionTitle : ""
          }\n` +
          `درصد سوخت‌گیری: ${actualPercent}%\n` +
          `مبلغ: ${totalCost} سولن\n` +
          "───────────────\n" +
          "لطفاً براساس قوانین بانک، این مبلغ را از حساب کاربر برداشت کنید.";

        await ctx.api.sendMessage(bankChatId, bankText);
      } catch (e) {
        console.error("send bank message error:", e);
      }
    }

    (ctx.session as any).fuelWizard = undefined;

    await sendVehicleScreen(
      ctx,
      `⛽ سوخت‌گیری کامل شد.\n` +
        `درصد اضافه‌شده: ${actualPercent}%\n` +
        `مبلغ: ${totalCost} سولن\n` +
        `سوخت فعلی: ${Math.min(
          100,
          (vehicle.fuel_percent ?? 0) + actualPercent
        )}%`,
      mainMenuKeyboard()
    );
  });
}
async function sendPvScreen(
  ctx: MyContext,
  text: string,
  keyboard?: InlineKeyboard
) {
  if (ctx.chat?.type === "private") {
    const lastId = (ctx.session as any).ui_last_message_id as
      | number
      | undefined;

    if (lastId) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, lastId);
      } catch {
        // اگر پیام قبلی پاک نشد، بی‌خیال
      }
    }

    const msg = await ctx.reply(text, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });

    (ctx.session as any).ui_last_message_id = msg.message_id;
  } else {
    await ctx.reply(text, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
  }
}
