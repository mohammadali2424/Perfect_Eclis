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
 * کیبورد منوی اصلی پی‌وی (فرض: در travel.ts یا جای دیگر چنین چیزی هست)
 * اگر جای دیگری تعریفش کرده‌ای و export شده، می‌توانی این تابع را حذف کنی
 * و مستقیم از آن استفاده کنی. این نسخه‌ی ساده fallback است.
 */
function mainMenuKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("🧭 مسیر های من", "paths:open")
    .row()
    .text("🗺 نقشه سریع من", "mymap:open");
  return kb;
}

/**
 * ثبت یک لاگ برای حرکت وسیله
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
 * محاسبه مصرف سوخت: هر ۱٪ ~ ۲ دقیقه رانندگی
 * driveSeconds / 120 = درصد سوخت مصرفی
 */
function computeFuelUsagePercent(driveSeconds: number): number {
  if (driveSeconds <= 0) return 0;
  return driveSeconds / 120; // هر 120 ثانیه ≈ 1%
}

export function registerVehicleTravelFeature(bot: Bot<MyContext>): void {
  //
  // 🏁 «ماشین های من» - لیست وسایل نقلیه
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
      .select(
        "id, title, type, capacity, fuel_percent, current_region_id, current_spot_id"
      )
      .eq("owner_char_id", char.id);

    if (error) {
      console.error("list my vehicles error:", error);
      await ctx.reply("در خواندن وسایل نقلیه مشکلی پیش آمد.");
      return;
    }

    if (!vehicles || vehicles.length === 0) {
      await ctx.reply(
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

    await ctx.reply("🚗 وسایل نقلیه‌ی تو در اکلیس:\n\n" + lines.join("\n"), {
      reply_markup: kb,
    });
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
    if (char.current_vehicle_id && char.current_vehicle_id !== vehicle.id) {
      await ctx.answerCallbackQuery({
        text: "الان سوار یک وسیله‌ی دیگر هستی. اول از آن پیاده شو.",
        show_alert: true,
      });
      return;
    }

    const { error: updErr } = await supabase
      .from("characters")
      .update({ current_vehicle_id: vehicle.id })
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

    const kb = new InlineKeyboard()
      .text("🛣 مسیرهای رانندگی", `veh:paths:${vehicle.id}`)
      .row()
      .text("⛽ سوخت‌گیری", `veh:fuel:${vehicle.id}`)
      .row()
      .text("🚶 پیاده شو", `veh:leave:${vehicle.id}`);

    await ctx.reply(
      `سوار ${vehicle.title} شدی.\n` +
        `نوع: ${vehicle.type}\n` +
        `سوخت فعلی: ${vehicle.fuel_percent}%`,
      { reply_markup: kb }
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

    if (char.current_vehicle_id !== vehicleId) {
      await ctx.answerCallbackQuery({
        text: "الان روی این وسیله سوار نیستی.",
        show_alert: true,
      });
      return;
    }

    const { error: updErr } = await supabase
      .from("characters")
      .update({ current_vehicle_id: null })
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

    await ctx.reply("🚶 از وسیله پیاده شدی.", {
      reply_markup: mainMenuKeyboard(),
    });
  });

  //
  // 🛣 مسیرهای رانندگی در نقطه‌ی فعلی
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

    if (char.current_vehicle_id !== vehicleId) {
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

    await ctx.reply(
      "🛣 مسیرهای رانندگی از جایگاه فعلی:\n\n" + lines.join("\n"),
      { reply_markup: kb }
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

    if (char.current_vehicle_id !== vehicleId) {
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

    const now = new Date();
    const arrival = new Date(now.getTime() + driveSeconds * 1000);

    const { error: updCharErr } = await supabase
      .from("characters")
      .update({
        pending_region_id: edge.to_region_id ?? null,
        pending_spot_id: edge.to_spot_id,
        travel_ready_at: arrival.toISOString(),
        travel_total_seconds: driveSeconds,
        travel_started_at: now.toISOString(),
        last_move_at: now.toISOString(),
      })
      .eq("id", char.id);

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

    await ctx.reply(
      "🚗 سفر رانندگی آغاز شد.\n" +
        `زمان تقریبی: ${driveSeconds} ثانیه\n` +
        `سوخت مصرف‌شده: ~${fuelNeededPercent.toFixed(1)}٪\n\n` +
        "وقتی فکر کردی زمانش گذشته، «رسیدم؟» را بزن.\n" +
        "اگر پشیمان شدی، می‌توانی «لغو مسیر» را بفرستی؛ اعتبار زمانی حساب می‌شود.",
      { reply_markup: kb }
    );
  });

  //
  // TODO: ⛽ سوخت گیری (veh:fuel:...) بعداً وصل می‌شود
  //
}
