import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";

type FuelWizardMode = "vehicle" | "canister" | "use_canister";

type FuelWizard = {
  mode: FuelWizardMode;
  step: "ask_amount" | "confirm";
  spotId: number;
  vehicleId?: number;
  sessionId?: number;       // برای flux_sessions
  maxPercent: number;
  pricePerPercent: number;
  amountPercent?: number;
  totalCost?: number;
};

type SessionData = MyContext["session"] & {
  vehicleHudMessageId?: number;
  fuelWizard?: FuelWizard;
};

async function getCharacterByTg(ctx: MyContext) {
  const { supabase } = ctx.services;
  if (!ctx.from) return { char: null, errorText: "حساب تلگرام نامشخص است." };

  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", ctx.from.id)
    .maybeSingle();

  if (error) {
    console.error("getCharacterByTg error:", error);
    return { char: null, errorText: "خطا در خواندن اطلاعات کاراکتر." };
  }

  if (!data) {
    return {
      char: null,
      errorText:
        "هنوز کاراکتر برایت ثبت نشده.\nبا دستور ثبت من / یا سیستم ثبت‌نام، اول کاراکترت را بساز.",
    };
  }

  return { char: data, errorText: null as string | null };
}

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

async function getFluxBasePrice(ctx: MyContext): Promise<number> {
  const { supabase } = ctx.services;
  const { data, error } = await supabase
    .from("economy_settings")
    .select("value_json")
    .eq("key", "flux_base_price")
    .maybeSingle();

  if (error) {
    console.error("getFluxBasePrice error:", error);
    return 5; // پیش‌فرض
  }

  const per = (data as any)?.value_json?.per_percent;
  const num = Number(per);
  if (!isFinite(num) || num <= 0) return 5;
  return num;
}

export function registerVehicleTravelFeature(bot: Bot<MyContext>): void {
  //
  // 🧾 ماشین‌های من (فقط در پی‌وی)
  //
bot.hears(/ماشین.?های.?من/i, async (ctx) => {
  if (ctx.chat.type !== "private") return;

  const { supabase } = ctx.services;
  const { char, errorText } = await getCharacterByTg(ctx);

  if (!char) {
    await ctx.reply(errorText!);
    return;
  }

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, title, type, capacity, fuel_percent, current_region_id, current_spot_id")
    .eq("owner_char_id", char.id);

  if (error) {
    console.error("list my vehicles error:", error);
    await ctx.reply("در خواندن وسایل نقلیه مشکلی پیش آمد.");
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    await ctx.reply(
      "هنوز هیچ وسیله‌ای در جهان اکلیس برایت ثبت نشده.\n" +
      "از ارباب یا شاپ درخواست کن برایت وسیله ثبت کنند."
    );
    return;
  }

  const lines: string[] = [];
  const kb = new InlineKeyboard();

  for (const v of vehicles) {
    lines.push(
      `• [${v.id}] ${v.title} (${v.type}) – ظرفیت: ${v.capacity} – سوخت: ${v.fuel_percent}%`
    );
    kb.text(`سوار ${v.title}`, `veh:board:${v.id}`).row();
  }

  await ctx.reply(
    "🚗 وسایل نقلیه‌ی تو در اکلیس:\n\n" + lines.join("\n"),
    { reply_markup: kb }
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
      await ctx.answerCallbackQuery({ text: errorText || "کاراکترت نامشخص است.", show_alert: true });
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
        text: "وسیله‌ای با این مشخصات پیدا نشد.",
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

    const { error: updErr } = await supabase
      .from("characters")
      .update({ current_vehicle_id: vehicle.id, riding_vehicle_id: null })
      .eq("id", char.id);

    if (updErr) {
      console.error("set current_vehicle_id error:", updErr);
      await ctx.answerCallbackQuery({
        text: "در سوار شدن مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();

    const s = ctx.session as SessionData;
    const kb = new InlineKeyboard()
      .text("🛣 مسیرهای رانندگی", `veh:paths:${vehicle.id}`).row()
      .text("🚪 پیاده می‌شوم", `veh:leave:${vehicle.id}`);

    const text =
      `🚗 داخل «${vehicle.title}»\n` +
      `نوع: ${vehicle.type}\n` +
      `سوخت: ${vehicle.fuel_percent}%\n\n` +
      `• مکان فعلی: Region #${vehicle.current_region_id} / Spot #${vehicle.current_spot_id}\n` +
      `از دکمه‌ی «🛣 مسیرهای رانندگی» برای حرکت استفاده کن.`;

    if (s.vehicleHudMessageId) {
      try {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          s.vehicleHudMessageId,
          text,
          { reply_markup: kb }
        );
        return;
      } catch {
        // اگر ادیت نشد، پیام جدید می‌فرستیم
      }
    }

    const msg = await ctx.reply(text, { reply_markup: kb });
    s.vehicleHudMessageId = msg.message_id;
  });

  //
  // 🚪 پیاده شدن از وسیله
  //
  bot.callbackQuery(/veh:leave:(\d+)/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }

    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);
    if (!char) {
      await ctx.answerCallbackQuery({
        text: errorText || "کاراکتر نامشخص.",
        show_alert: true,
      });
      return;
    }

    const { error } = await supabase
      .from("characters")
      .update({ current_vehicle_id: null })
      .eq("id", char.id);

    if (error) {
      console.error("veh:leave update error:", error);
      await ctx.answerCallbackQuery({
        text: "در پیاده شدن مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();

    const s = ctx.session as SessionData;
    if (s.vehicleHudMessageId) {
      try {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          s.vehicleHudMessageId,
          "از وسیله پیاده شدی.\nمی‌توانی از 🧭 مسیر های من برای حرکت پیاده استفاده کنی."
        );
      } catch (e) {
        console.warn("edit HUD after leave failed:", e);
      }
      s.vehicleHudMessageId = undefined;
    } else {
      await ctx.reply("از وسیله پیاده شدی.");
    }
  });

  //
  // 🛣 مسیرهای رانندگی
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
        text: errorText || "کاراکتر نامشخص.",
        show_alert: true,
      });
      return;
    }

    if (char.current_vehicle_id !== vehicleId) {
      await ctx.answerCallbackQuery({
        text: "الان سوار این وسیله نیستی.",
        show_alert: true,
      });
      return;
    }

    if (char.current_spot_id == null) {
      await ctx.answerCallbackQuery({
        text: "مکان فعلی‌ات مشخص نیست. باید ابتدا در یک Spot ثبت شوی.",
        show_alert: true,
      });
      return;
    }

    const { data: vehicle, error: vehErr } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .maybeSingle();

    if (vehErr || !vehicle) {
      console.error("veh:paths load vehicle error:", vehErr);
      await ctx.answerCallbackQuery({
        text: "وسیله پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    const fromSpotId = char.current_spot_id;

    const { data: edges, error: edgeErr } = await supabase
      .from("edges")
      .select("id, to_spot_id, travel_seconds, drive_seconds, allow_drive")
      .eq("from_spot_id", fromSpotId)
      .eq("allow_drive", true);

    if (edgeErr) {
      console.error("veh:paths edges error:", edgeErr);
      await ctx.answerCallbackQuery({
        text: "در خواندن مسیرهای رانندگی مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    if (!edges || edges.length === 0) {
      await ctx.answerCallbackQuery();
      await ctx.reply("هیچ مسیر رانندگی از این مکان تعریف نشده است.");
      return;
    }

    const toIds = edges.map((e) => e.to_spot_id);
    const { data: spots, error: spotErr } = await supabase
      .from("spots")
      .select("id, title, region_id")
      .in("id", toIds);

    if (spotErr) {
      console.error("veh:paths spots error:", spotErr);
      await ctx.answerCallbackQuery({
        text: "در خواندن مقصدها مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    const spotMap = new Map<number, any>();
    spots?.forEach((s) => spotMap.set(s.id, s));

    const kb = new InlineKeyboard();
    const lines: string[] = [];

    for (const e of edges) {
      const dest = spotMap.get(e.to_spot_id);
      const name = dest?.title || `Spot #${e.to_spot_id}`;
      const driveSeconds = e.drive_seconds ?? e.travel_seconds ?? 0;
      if (!driveSeconds) continue;

      const minutes = Math.ceil(driveSeconds / 60);
      const fuelCost = Math.ceil(driveSeconds / 120); // هر ۱٪ = ۲ دقیقه

      lines.push(
        `• ${name} – زمان تقریبی: ${minutes} دقیقه – مصرف فلوکس: ${fuelCost}%`
      );
      kb.text(`به ${name}`, `veh:go:${vehicleId}:${e.id}`).row();
    }

    if (lines.length === 0) {
      await ctx.answerCallbackQuery();
      await ctx.reply("مسیر رانندگی معتبر از این Spot پیدا نشد.");
      return;
    }

    const s = ctx.session as SessionData;
    const text =
      `🛣 مسیرهای رانندگی از این مکان\n` +
      `وسیله: ${vehicle.title} – سوخت: ${vehicle.fuel_percent}%\n\n` +
      lines.join("\n");

    await ctx.answerCallbackQuery();

    if (s.vehicleHudMessageId) {
      try {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          s.vehicleHudMessageId,
          text,
          { reply_markup: kb }
        );
        return;
      } catch {
        // اگر ادیت نشد، پیام جدید
      }
    }

    const msg = await ctx.reply(text, { reply_markup: kb });
    s.vehicleHudMessageId = msg.message_id;
  });

  //
  // 🚗 شروع سفر رانندگی (veh:go:vehicleId:edgeId)
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
        text: errorText || "کاراکتر نامشخص.",
        show_alert: true,
      });
      return;
    }

    if (char.current_vehicle_id !== vehicleId) {
      await ctx.answerCallbackQuery({
        text: "الان سوار این وسیله نیستی.",
        show_alert: true,
      });
      return;
    }

    const { data: edge, error: edgeErr } = await supabase
      .from("edges")
      .select("id, from_spot_id, to_spot_id, travel_seconds, drive_seconds, allow_drive")
      .eq("id", edgeId)
      .maybeSingle();

    if (edgeErr || !edge) {
      console.error("veh:go edge error:", edgeErr);
      await ctx.answerCallbackQuery({
        text: "مسیر پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    if (!edge.allow_drive) {
      await ctx.answerCallbackQuery({
        text: "این مسیر برای رانندگی فعال نیست.",
        show_alert: true,
      });
      return;
    }

    if (char.current_spot_id !== edge.from_spot_id) {
      await ctx.answerCallbackQuery({
        text: "در مبدأ این مسیر نیستی.",
        show_alert: true,
      });
      return;
    }

    const { data: destSpot, error: spotErr } = await supabase
      .from("spots")
      .select("id, title, region_id")
      .eq("id", edge.to_spot_id)
      .maybeSingle();

    if (spotErr || !destSpot) {
      console.error("veh:go dest spot error:", spotErr);
      await ctx.answerCallbackQuery({
        text: "مقصد این مسیر پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    const driveSeconds = edge.drive_seconds ?? edge.travel_seconds ?? 0;
    if (!driveSeconds) {
      await ctx.answerCallbackQuery({
        text: "زمان رانندگی برای این مسیر مشخص نشده.",
        show_alert: true,
      });
      return;
    }

    const { data: vehicle, error: vehErr } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .maybeSingle();

    if (vehErr || !vehicle) {
      console.error("veh:go vehicle error:", vehErr);
      await ctx.answerCallbackQuery({
        text: "وسیله پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    const fuelCost = Math.ceil(driveSeconds / 120); // هر ۱٪ = ۲ دقیقه
    if (vehicle.fuel_percent < fuelCost) {
      await ctx.answerCallbackQuery({
        text: "فلوکس این وسیله برای این مسیر کافی نیست.",
        show_alert: true,
      });
      return;
    }

    const newFuel = vehicle.fuel_percent - fuelCost;

    const now = new Date();
    const readyAt = new Date(now.getTime() + driveSeconds * 1000);

    const { error: fuelErr } = await supabase
      .from("vehicles")
      .update({
        fuel_percent: newFuel,
        current_region_id: destSpot.region_id,
        current_spot_id: destSpot.id,
      })
      .eq("id", vehicle.id);

    if (fuelErr) {
      console.error("veh:go fuel update error:", fuelErr);
      await ctx.answerCallbackQuery({
        text: "در به‌روزرسانی فلوکس مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    const { error: charErr2 } = await supabase
      .from("characters")
      .update({
        pending_region_id: destSpot.region_id,
        pending_spot_id: destSpot.id,
        travel_ready_at: readyAt.toISOString(),
        last_move_at: now.toISOString(),
      })
      .eq("id", char.id);

    if (charErr2) {
      console.error("veh:go character travel update error:", charErr2);
      await ctx.answerCallbackQuery({
        text: "در ثبت سفر مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();

    const minutes = Math.ceil(driveSeconds / 60);
    const s = ctx.session as SessionData;
    const kb = new InlineKeyboard().text("🕒 رسیدم؟", "travel:arrive");

    const text =
      `🚗 در حال رانندگی به سمت: ${destSpot.title}\n` +
      `زمان تقریبی سفر: ${minutes} دقیقه\n` +
      `مصرف فلوکس این مسیر: ${fuelCost}%\n` +
      `فلوکس باقی‌مانده: ${newFuel}%\n\n` +
      `هر وقت فکر کردی زمانش گذشته، از دکمه‌ی «🕒 رسیدم؟» یا دستور /arrive استفاده کن.`;

    if (s.vehicleHudMessageId) {
      try {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          s.vehicleHudMessageId,
          text,
          { reply_markup: kb }
        );
        return;
      } catch {
        // پیام جدید اگر ادیت نشد
      }
    }

    const msg = await ctx.reply(text, { reply_markup: kb });
    s.vehicleHudMessageId = msg.message_id;
  });

  //
  // ⛽ سوخت‌گیری مستقیم
  //
  bot.hears("سوخت گیری", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    const s = ctx.session as SessionData;
    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.reply(errorText!);
      return;
    }

    if (char.current_region_id == null || char.current_spot_id == null) {
      await ctx.reply("مکان فعلی‌ات مشخص نیست. باید در یک Spot ثبت باشی.");
      return;
    }

    if (!char.current_vehicle_id) {
      await ctx.reply("برای سوخت‌گیری باید سوار یک وسیله باشی.");
      return;
    }

    const { data: spot, error: spotErr } = await supabase
      .from("spots")
      .select("id, title, is_flux_station, flux_price_multiplier")
      .eq("id", char.current_spot_id)
      .maybeSingle();

    if (spotErr || !spot) {
      console.error("fuel spot error:", spotErr);
      await ctx.reply("جایگاه فعلی پیدا نشد.");
      return;
    }

    if (!spot.is_flux_station) {
      await ctx.reply("این مکان چاه فلوکس نیست. باید در یک جایگاه فلوکس باشی.");
      return;
    }

    const { data: vehicle, error: vehErr } = await supabase
      .from("vehicles")
      .select("id, title, fuel_percent")
      .eq("id", char.current_vehicle_id)
      .maybeSingle();

    if (vehErr || !vehicle) {
      console.error("fuel vehicle error:", vehErr);
      await ctx.reply("وسیله‌ای که سوارش هستی پیدا نشد.");
      return;
    }

    const maxAdd = 100 - vehicle.fuel_percent;
    if (maxAdd <= 0) {
      await ctx.reply("باک این وسیله همین حالا هم پر است.");
      return;
    }

    // ظرفیت ۲ پمپ
    const { data: activeSessions, error: sessErr } = await supabase
      .from("flux_sessions")
      .select("id")
      .eq("spot_id", spot.id)
      .eq("state", "fueling");

    if (sessErr) {
      console.error("flux_sessions count error:", sessErr);
      await ctx.reply("در بررسی ظرفیت جایگاه مشکلی پیش آمد.");
      return;
    }

    if ((activeSessions?.length || 0) >= 2) {
      await ctx.reply(
        "هر دو جایگاه فلوکس در حال استفاده‌اند.\n" +
          "باید کمی صبر کنی تا نوبتت برسد."
      );
      return;
    }

    // ایجاد جلسه سوخت‌گیری
    const { data: session, error: newSessErr } = await supabase
      .from("flux_sessions")
      .insert({
        char_id: char.id,
        spot_id: spot.id,
        vehicle_id: vehicle.id,
        mode: "direct",
        state: "fueling",
      })
      .select("id")
      .single();

    if (newSessErr) {
      console.error("create flux_session error:", newSessErr);
      await ctx.reply("در شروع سوخت‌گیری مشکل پیش آمد.");
      return;
    }

    const basePrice = await getFluxBasePrice(ctx);
    const multiplier = spot.flux_price_multiplier ?? 1;
    const pricePerPercent = basePrice * Number(multiplier || 1);

    s.fuelWizard = {
      mode: "vehicle",
      step: "ask_amount",
      spotId: spot.id,
      vehicleId: vehicle.id,
      sessionId: session.id,
      maxPercent: maxAdd,
      pricePerPercent,
    };

    await ctx.reply(
      `⛽ چاه فلوکس: ${spot.title}\n` +
        `وسیله: ${vehicle.title}\n` +
        `سوخت فعلی: ${vehicle.fuel_percent}%\n\n` +
        `می‌توانی تا حداکثر ${maxAdd}% دیگر باک را پر کنی.\n` +
        `قیمت این جایگاه: ${pricePerPercent} Solen برای هر ۱٪.\n\n` +
        `عدد درصد مورد نظر را بفرست (۱ تا ${maxAdd}).`
    );
  });

  //
  // 🧪 خرید فلوکس اضطراری (ظرف)
  //
  bot.hears("خرید فلوکس اضطراری", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    const s = ctx.session as SessionData;
    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.reply(errorText!);
      return;
    }

    if (char.current_region_id == null || char.current_spot_id == null) {
      await ctx.reply("مکان فعلی‌ات مشخص نیست. باید در یک Spot ثبت باشی.");
      return;
    }

    const { data: spot, error: spotErr } = await supabase
      .from("spots")
      .select("id, title, is_flux_station, has_emergency_flux, flux_price_multiplier")
      .eq("id", char.current_spot_id)
      .maybeSingle();

    if (spotErr || !spot) {
      console.error("emergency spot error:", spotErr);
      await ctx.reply("جایگاه فعلی پیدا نشد.");
      return;
    }

    if (!spot.is_flux_station || !spot.has_emergency_flux) {
      await ctx.reply(
        "اینجا چاه اضطراری فلوکس نیست.\n" +
          "باید در جایگاهی باشی که فروش ظرف فلوکس فعال باشد."
      );
      return;
    }

    // ظرفیت ۲ پمپ
    const { data: activeSessions, error: sessErr } = await supabase
      .from("flux_sessions")
      .select("id")
      .eq("spot_id", spot.id)
      .eq("state", "fueling");

    if (sessErr) {
      console.error("flux_sessions count error:", sessErr);
      await ctx.reply("در بررسی ظرفیت جایگاه مشکلی پیش آمد.");
      return;
    }

    if ((activeSessions?.length || 0) >= 2) {
      await ctx.reply(
        "هر دو جایگاه فلوکس در حال استفاده‌اند.\n" +
          "باید کمی صبر کنی تا نوبتت برسد."
      );
      return;
    }

    const { data: session, error: newSessErr } = await supabase
      .from("flux_sessions")
      .insert({
        char_id: char.id,
        spot_id: spot.id,
        vehicle_id: null,
        mode: "canister",
        state: "fueling",
      })
      .select("id")
      .single();

    if (newSessErr) {
      console.error("create emergency flux_session error:", newSessErr);
      await ctx.reply("در شروع خرید ظرف فلوکس مشکل پیش آمد.");
      return;
    }

    const basePrice = await getFluxBasePrice(ctx);
    const multiplier = spot.flux_price_multiplier ?? 1;
    const normalPricePerPercent = basePrice * Number(multiplier || 1);
    const pricePerPercent = normalPricePerPercent * 1.4; // ۴۰٪ گرون‌تر

    s.fuelWizard = {
      mode: "canister",
      step: "ask_amount",
      spotId: spot.id,
      sessionId: session.id,
      maxPercent: 100,
      pricePerPercent,
    };

    await ctx.reply(
      `🧪 خرید فلوکس اضطراری در ${spot.title}\n\n` +
        `قیمت: ${pricePerPercent.toFixed(2)} Solen برای هر ۱٪.\n` +
        `حداکثر می‌توانی ۱۰۰٪ ظرفیت ظرف را پر کنی.\n\n` +
        "عدد درصد مورد نظر را بفرست (۱ تا ۱۰۰)."
    );
  });

  //
  // 🧪 استفاده از فلوکس (ظرف → باک وسیله)
  //
  bot.hears("استفاده از فلوکس", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    const s = ctx.session as SessionData;
    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.reply(errorText!);
      return;
    }

    if (!char.current_vehicle_id) {
      await ctx.reply("برای استفاده از ظرف فلوکس باید سوار یک وسیله باشی.");
      return;
    }

    const { data: can, error: canErr } = await supabase
      .from("flux_canisters")
      .select("amount_percent")
      .eq("char_id", char.id)
      .maybeSingle();

    if (canErr) {
      console.error("flux_canisters read error:", canErr);
      await ctx.reply("در بررسی ظرف فلوکس مشکلی پیش آمد.");
      return;
    }

    const available = can?.amount_percent ?? 0;
    if (available <= 0) {
      await ctx.reply("هیچ فلوکس ذخیره‌ای در ظرف نداری.");
      return;
    }

    const { data: vehicle, error: vehErr } = await supabase
      .from("vehicles")
      .select("id, title, fuel_percent")
      .eq("id", char.current_vehicle_id)
      .maybeSingle();

    if (vehErr || !vehicle) {
      console.error("use flux vehicle error:", vehErr);
      await ctx.reply("وسیله‌ای که سوارش هستی پیدا نشد.");
      return;
    }

    const tankFree = 100 - vehicle.fuel_percent;
    if (tankFree <= 0) {
      await ctx.reply("باک این وسیله همین حالا هم پر است.");
      return;
    }

    const maxUse = Math.min(available, tankFree);

    s.fuelWizard = {
      mode: "use_canister",
      step: "ask_amount",
      spotId: char.current_spot_id ?? 0,
      vehicleId: vehicle.id,
      maxPercent: maxUse,
      pricePerPercent: 0, // اینجا هزینه‌ای نمی‌گیرد (قبلاً پرداخت شده)
    };

    await ctx.reply(
      `🧪 استفاده از فلوکس روی «${vehicle.title}»\n` +
        `سوخت فعلی: ${vehicle.fuel_percent}%\n` +
        `ظرف فلوکس در اختیار: ${available}%\n` +
        `حداکثر می‌توانی ${maxUse}% روی این وسیله بریزی.\n\n` +
        `عدد درصد مورد نظر را بفرست (۱ تا ${maxUse}).`
    );
  });

  //
  // 🎛 هندل ویزارد سوخت / ظرف (در پی‌وی)
  //
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat.type !== "private") {
      // پیام‌های گروهی مربوط به این ماژول نیستن → بدیم بقیه هندلرها
      return next();
    }

    const s = ctx.session as SessionData;
    const { supabase } = ctx.services;
    const text = ctx.message.text.trim();

    const fw = s.fuelWizard;
    if (!fw) {
      // هیچ ویزارد سوخت فعالی نیست → بذار travel.ts و بقیه جواب بدن
      return next();
    }

    if (fw.step === "ask_amount") {
      const num = Number(text);
      if (!Number.isFinite(num) || num <= 0 || num > fw.maxPercent) {
        await ctx.reply(
          `عدد نامعتبر. عددی بین ۱ تا ${fw.maxPercent} بفرست.`
        );
        return;
      }

      fw.amountPercent = num;

      if (fw.mode === "use_canister") {
        fw.totalCost = 0;
        fw.step = "confirm";
        await ctx.reply(
          `قرار است ${num}% از ظرف فلوکس را روی این وسیله بریزیم.\n` +
            "برای تایید بنویس «تایید»، برای لغو بنویس «لغو»."
        );
        return;
      }

      const cost = num * fw.pricePerPercent;
      fw.totalCost = cost;
      fw.step = "confirm";

      await ctx.reply(
        `درصد انتخابی: ${num}%\n` +
          `هزینه: ${cost.toFixed(2)} Solen\n\n` +
          "برای تایید بنویس «تایید»، برای لغو بنویس «لغو»."
      );
      return;
    }

    if (fw.step === "confirm") {
      if (text === "لغو") {
        // اگر جلسه سوخت‌گیری داریم، کنسلش کنیم
        if (fw.sessionId) {
          await supabase
            .from("flux_sessions")
            .update({ state: "cancelled" })
            .eq("id", fw.sessionId);
        }
        s.fuelWizard = undefined;
        await ctx.reply("❌ عملیات لغو شد.");
        return;
      }

      if (text !== "تایید") {
        await ctx.reply("برای تایید بنویس «تایید»، برای لغو بنویس «لغو».");
        return;
      }

      const amount = fw.amountPercent ?? 0;
      if (!amount || amount <= 0) {
        s.fuelWizard = undefined;
        await ctx.reply("مقدار نامشخص است، ویزارد ریست می‌شود.");
        return;
      }

      const { char, errorText } = await getCharacterByTg(ctx);
      if (!char) {
        s.fuelWizard = undefined;
        await ctx.reply(errorText || "کاراکتر نامشخص.");
        return;
      }

      //
      // مود ۱: سوخت مستقیم روی وسیله
      //
      if (fw.mode === "vehicle") {
        if (!fw.vehicleId) {
          s.fuelWizard = undefined;
          await ctx.reply("وسیله نامشخص است، ویزارد ریست شد.");
          return;
        }

        const { data: vehicle, error: vehErr } = await supabase
          .from("vehicles")
          .select("id, title, fuel_percent")
          .eq("id", fw.vehicleId)
          .maybeSingle();

        if (vehErr || !vehicle) {
          console.error("confirm fuel vehicle error:", vehErr);
          s.fuelWizard = undefined;
          await ctx.reply("وسیله برای تکمیل سوخت‌گیری پیدا نشد.");
          return;
        }

        const maxAdd = 100 - vehicle.fuel_percent;
        const finalAmount = Math.min(amount, maxAdd);
        const newFuel = vehicle.fuel_percent + finalAmount;

        const { error: updErr } = await supabase
          .from("vehicles")
          .update({ fuel_percent: newFuel })
          .eq("id", vehicle.id);

        if (updErr) {
          console.error("update vehicle fuel error:", updErr);
          s.fuelWizard = undefined;
          await ctx.reply("در به‌روزرسانی سوخت وسیله مشکلی پیش آمد.");
          return;
        }

        if (fw.sessionId) {
          await supabase
            .from("flux_sessions")
            .update({ state: "done" })
            .eq("id", fw.sessionId);
        }

        // پیام به بانک
        const bankChatId = await getBankChatId(ctx);
        if (bankChatId && fw.totalCost) {
          try {
            await ctx.api.sendMessage(
              bankChatId,
              `💳 تراکنش سوخت – چاه فلوکس\n\n` +
                `کاربر: ${ctx.from?.first_name} (tg_id=${ctx.from?.id})\n` +
                `کاراکتر: ${char.char_name || "—"}\n` +
                `وسیله: ${vehicle.title}\n` +
                `مقدار سوخت: +${finalAmount}%\n` +
                `مبلغ: ${fw.totalCost.toFixed(2)} Solen\n`
            );
          } catch (e) {
            console.error("send bank tx error:", e);
          }
        }

        s.fuelWizard = undefined;
        await ctx.reply(
          `✅ باک «${vehicle.title}» به اندازه ${finalAmount}% پر شد.\n` +
            `سوخت فعلی: ${newFuel}%.`
        );
        return;
      }

      //
      // مود ۲: خرید ظرف فلوکس اضطراری
      //
      if (fw.mode === "canister") {
        const finalAmount = amount;

        // جمع کردن روی flux_canisters
        const { data: existing, error: canErr } = await supabase
          .from("flux_canisters")
          .select("amount_percent")
          .eq("char_id", char.id)
          .maybeSingle();

        if (canErr) {
          console.error("flux_canisters read error:", canErr);
        }

        const current = existing?.amount_percent ?? 0;
        const newAmount = current + finalAmount;

        let upErr;
        if (existing) {
          const { error } = await supabase
            .from("flux_canisters")
            .update({ amount_percent: newAmount })
            .eq("char_id", char.id);
          upErr = error;
        } else {
          const { error } = await supabase
            .from("flux_canisters")
            .insert({ char_id: char.id, amount_percent: newAmount });
          upErr = error;
        }

        if (upErr) {
          console.error("flux_canisters upsert error:", upErr);
          s.fuelWizard = undefined;
          await ctx.reply("در ثبت ظرف فلوکس مشکلی پیش آمد.");
          return;
        }

        if (fw.sessionId) {
          await supabase
            .from("flux_sessions")
            .update({ state: "done" })
            .eq("id", fw.sessionId);
        }

        const bankChatId = await getBankChatId(ctx);
        if (bankChatId && fw.totalCost) {
          try {
            await ctx.api.sendMessage(
              bankChatId,
              `💳 تراکنش فلوکس اضطراری\n\n` +
                `کاربر: ${ctx.from?.first_name} (tg_id=${ctx.from?.id})\n` +
                `کاراکتر: ${char.char_name || "—"}\n` +
                `مقدار فلوکس ظرف: +${finalAmount}%\n` +
                `مجموع ذخیره ظرف: ${newAmount}%\n` +
                `مبلغ: ${fw.totalCost.toFixed(2)} Solen\n`
            );
          } catch (e) {
            console.error("send bank tx error:", e);
          }
        }

        s.fuelWizard = undefined;
        await ctx.reply(
          `✅ ${finalAmount}% فلوکس اضطراری به ظرفت اضافه شد.\n` +
            `کل فلوکس ذخیره: ${newAmount}%.`
        );
        return;
      }

      //
      // مود ۳: استفاده از ظرف فلوکس روی وسیله
      //
      if (fw.mode === "use_canister") {
        if (!fw.vehicleId) {
          s.fuelWizard = undefined;
          await ctx.reply("وسیله نامشخص است، ویزارد ریست شد.");
          return;
        }

        const { data: can, error: canErr } = await supabase
          .from("flux_canisters")
          .select("amount_percent")
          .eq("char_id", char.id)
          .maybeSingle();

        if (canErr) {
          console.error("flux_canisters read error:", canErr);
          s.fuelWizard = undefined;
          await ctx.reply("در خواندن ظرف فلوکس مشکلی پیش آمد.");
          return;
        }

        const available = can?.amount_percent ?? 0;
        if (available <= 0) {
          s.fuelWizard = undefined;
          await ctx.reply("هیچ فلوکس ذخیره‌ای در ظرف نداری.");
          return;
        }

        const { data: vehicle, error: vehErr } = await supabase
          .from("vehicles")
          .select("id, title, fuel_percent")
          .eq("id", fw.vehicleId)
          .maybeSingle();

        if (vehErr || !vehicle) {
          console.error("use_canister vehicle error:", vehErr);
          s.fuelWizard = undefined;
          await ctx.reply("وسیله برای استفاده از فلوکس پیدا نشد.");
          return;
        }

        const tankFree = 100 - vehicle.fuel_percent;
        if (tankFree <= 0) {
          s.fuelWizard = undefined;
          await ctx.reply("باک این وسیله همین حالا هم پر است.");
          return;
        }

        const maxUse = Math.min(available, tankFree);
        const finalAmount = Math.min(amount, maxUse);
        const newFuel = vehicle.fuel_percent + finalAmount;
        const newCanAmount = available - finalAmount;

        const { error: vehUpdErr } = await supabase
          .from("vehicles")
          .update({ fuel_percent: newFuel })
          .eq("id", vehicle.id);

        if (vehUpdErr) {
          console.error("update vehicle fuel (use_canister) error:", vehUpdErr);
          s.fuelWizard = undefined;
          await ctx.reply("در به‌روزرسانی سوخت وسیله مشکلی پیش آمد.");
          return;
        }

        const { error: canUpdErr } = await supabase
          .from("flux_canisters")
          .update({ amount_percent: newCanAmount })
          .eq("char_id", char.id);

        if (canUpdErr) {
          console.error("update flux_canisters error:", canUpdErr);
          // از نظر بازی سوخت وسیله درست شده، ولی ظرف درست آپدیت نشده؛
          // بیشتر از این سختش نکنیم.
        }

        s.fuelWizard = undefined;
        await ctx.reply(
          `✅ ${finalAmount}% فلوکس از ظرف روی «${vehicle.title}» ریخته شد.\n` +
            `سوخت فعلی وسیله: ${newFuel}%\n` +
            `فلوکس باقی‌مانده در ظرف: ${newCanAmount}%.`
        );
        return;
      }

      // اگر مود ناشناس شد:
      s.fuelWizard = undefined;
      await ctx.reply("ویزارد ناشناس بود و ریست شد.");
    }
  });
}
