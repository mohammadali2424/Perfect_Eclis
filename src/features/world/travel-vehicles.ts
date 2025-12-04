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
      errorText: "در خواندن پرونده‌ی کاراکترت مشکلی پیش آمد.",
    };
  }

  if (!data) {
    return {
      char: null as any,
      errorText:
        "هنوز در اکلیس ثبت نشده‌ای.\nاز «ثبت من» یا /start استفاده کن.",
    };
  }

  return { char: data, errorText: "" };
}

/**
 * منوی اصلی پی‌وی
 */
function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text("🧭 مسیر های من", "paths:open")
    .row()
    .text("🗺 نقشه سریع من", "map:me")
    .row()
    .text("🚗 ماشین های من", "veh:menu");
}

/**
 * فیچر حرکت با وسیله (ماشین/موتور)
 */
export function registerVehicleTravelFeature(bot: Bot<MyContext>): void {
  //
  // 🧾 ماشین های من
  //
  bot.hears(/ماشین.?های.?من/i, async (ctx) => {
    if (ctx.chat?.type !== "private") return;

    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.reply(errorText);
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
          "از ارباب یا شاپ بخواه برایت وسیله ثبت کنند.",
        { reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    const lines: string[] = [];
    const kb = new InlineKeyboard();

    for (const v of vehicles as any[]) {
      lines.push(
        `• [${v.id}] ${v.title} (${v.type}) – ظرفیت: ${v.capacity} – سوخت: ${v.fuel_percent}%`
      );
      kb.text(`سوار ${v.title}`, `veh:board:${v.id}`).row();
    }

    kb.text("🔙 منوی اصلی", "menu:main");

    await ctx.reply("🚗 وسایل نقلیه‌ی تو در اکلیس:\n\n" + lines.join("\n"), {
      reply_markup: kb,
    });
  });

  //
  // منوی ماشین‌ها از منوی اصلی
  //
  bot.callbackQuery("veh:menu", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    // شورتکات: مثل زدن "ماشین های من"
    await ctx.api.sendMessage(ctx.from!.id, "ماشین های من");
  });

  //
  // HUD یک وسیله (board)
  //
  bot.callbackQuery(/^veh:board:(\d+)$/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const vehicleId = Number(ctx.match![1]);
    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.reply(errorText);
      return;
    }

    const { data: vehicle, error: vehErr } = await supabase
      .from("vehicles")
      .select(
        "id, title, type, capacity, fuel_percent, current_region_id, current_spot_id, owner_char_id"
      )
      .eq("id", vehicleId)
      .maybeSingle();

    if (vehErr || !vehicle) {
      console.error("veh:board vehicle error:", vehErr);
      await ctx.reply("این وسیله دیگر در جهان وجود ندارد.");
      return;
    }

    if (vehicle.owner_char_id !== char.id) {
      await ctx.reply("این وسیله متعلق به تو نیست.");
      return;
    }

    let locationText = "نامشخص";
    if (vehicle.current_region_id && vehicle.current_spot_id) {
      const { data: spotInfo, error: spotErr } = await supabase
        .from("spots")
        .select("title, region_id")
        .eq("id", vehicle.current_spot_id)
        .maybeSingle();

      if (!spotErr && spotInfo) {
        const { data: regionInfo } = await supabase
          .from("regions")
          .select("title")
          .eq("id", spotInfo.region_id)
          .maybeSingle();
        locationText = `${regionInfo?.title ?? "Region?"} / ${spotInfo.title}`;
      }
    }

    const kb = new InlineKeyboard()
      .text("🛣 مسیرهای رانندگی", `veh:paths:${vehicle.id}`)
      .row()
      .text("⛽ سوخت گیری", `veh:fuel:${vehicle.id}`)
      .row()
      .text("🚶 پیاده شدن", `veh:leave:${vehicle.id}`)
      .row()
      .text("🔙 منوی اصلی", "menu:main");

    const text =
      `🚗 ${vehicle.title} (${vehicle.type})\n\n` +
      `• سوخت: ${vehicle.fuel_percent}%\n` +
      `• ظرفیت: ${vehicle.capacity}\n` +
      `• مکان: ${locationText}\n`;

    await ctx.reply(text, { reply_markup: kb });
  });

  //
  // لیست مسیرهای رانندگی از Spot فعلی
  //
  bot.callbackQuery(/^veh:paths:(\d+)$/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const vehicleId = Number(ctx.match![1]);
    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.reply(errorText);
      return;
    }

    const { data: vehicle, error: vehErr } = await supabase
      .from("vehicles")
      .select(
        "id, title, current_region_id, current_spot_id, owner_char_id, fuel_percent"
      )
      .eq("id", vehicleId)
      .maybeSingle();

    if (vehErr || !vehicle) {
      console.error("veh:paths vehicle error:", vehErr);
      await ctx.reply("این وسیله دیگر در جهان وجود ندارد.");
      return;
    }

    if (vehicle.owner_char_id !== char.id) {
      await ctx.reply("این وسیله متعلق به تو نیست.");
      return;
    }

    if (!vehicle.current_spot_id) {
      await ctx.reply("این وسیله هنوز در هیچ مکانی ثبت نشده است.");
      return;
    }

    if (char.current_spot_id !== vehicle.current_spot_id) {
      await ctx.reply(
        "برای دیدن مسیرهای رانندگی این وسیله، باید در همان مکان آن حاضر باشی.",
        { reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    const { data: edges, error: edgeErr } = await supabase
      .from("edges")
      .select("id, to_spot_id, drive_seconds, allow_drive")
      .eq("from_spot_id", vehicle.current_spot_id)
      .eq("allow_drive", true);

    if (edgeErr) {
      console.error("veh:paths edges error:", edgeErr);
      await ctx.reply("در خواندن مسیرهای رانندگی مشکلی پیش آمد.");
      return;
    }

    if (!edges || edges.length === 0) {
      await ctx.reply(
        "از این مکان، هیچ مسیری برای رانندگی تعریف نشده است.\n" +
          "ارباب باید از طریق «ساخت مسیر رانندگی» آن را بسازد.",
        { reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    const toIds = edges.map((e: any) => e.to_spot_id);
    const { data: destSpots, error: destErr } = await supabase
      .from("spots")
      .select("id, title")
      .in("id", toIds);

    if (destErr || !destSpots) {
      console.error("veh:paths destSpots error:", destErr);
      await ctx.reply("در خواندن مقصدها مشکلی پیش آمد.");
      return;
    }

    const destMap = new Map<number, string>();
    for (const s of destSpots as any[]) destMap.set(s.id, s.title);

    const kb = new InlineKeyboard();
    for (const e of edges as any[]) {
      const name = destMap.get(e.to_spot_id) ?? `مقصد ${e.to_spot_id}`;
      const driveSecs = e.drive_seconds ?? 0;
      const mins = Math.max(1, Math.round(driveSecs / 60));
      const fuelCost = Math.max(1, Math.ceil(driveSecs / 120)); // هر ۲ دقیقه = ۱٪

      kb.text(
        `➤ ${name} ~ ${mins} دقیقه ~ -${fuelCost}%`,
        `veh:go:${vehicle.id}:${e.id}`
      ).row();
    }

    kb.text("🔙 برگشت", `veh:board:${vehicle.id}`);

    await ctx.reply(
      `🛣 مسیرهای رانندگی قابل دسترس برای ${vehicle.title}:`,
      { reply_markup: kb }
    );
  });

  //
  // شروع سفر با ماشین
  //
  bot.callbackQuery(/^veh:go:(\d+):(\d+)$/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const vehicleId = Number(ctx.match![1]);
    const edgeId = Number(ctx.match![2]);
    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.reply(errorText);
      return;
    }

    const { data: vehicle, error: vehErr } = await supabase
      .from("vehicles")
      .select(
        "id, title, current_region_id, current_spot_id, owner_char_id, fuel_percent"
      )
      .eq("id", vehicleId)
      .maybeSingle();

    if (vehErr || !vehicle) {
      console.error("veh:go vehicle error:", vehErr);
      await ctx.reply("این وسیله دیگر در جهان وجود ندارد.");
      return;
    }

    if (vehicle.owner_char_id !== char.id) {
      await ctx.reply("این وسیله متعلق به تو نیست.");
      return;
    }

    if (!vehicle.current_spot_id) {
      await ctx.reply("این وسیله هنوز در هیچ مکانی ثبت نشده است.");
      return;
    }

    if (char.current_spot_id !== vehicle.current_spot_id) {
      await ctx.reply(
        "برای حرکت با این وسیله، باید در همان مکان آن حاضر باشی.",
        { reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    const { data: edge, error: edgeErr } = await supabase
      .from("edges")
      .select("id, from_spot_id, to_spot_id, drive_seconds, allow_drive")
      .eq("id", edgeId)
      .maybeSingle();

    if (edgeErr || !edge || !edge.allow_drive) {
      console.error("veh:go edge error:", edgeErr);
      await ctx.reply("این مسیر رانندگی دیگر معتبر نیست.");
      return;
    }

    if (edge.from_spot_id !== vehicle.current_spot_id) {
      await ctx.reply(
        "الان در مبدأ این مسیر نیستی.\n" +
          "ابتدا نقشه‌ی مسیرهای رانندگی را تازه کن.",
        { reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    const driveSecs = edge.drive_seconds ?? 0;
    if (driveSecs <= 0) {
      await ctx.reply("این مسیر هنوز زمان رانندگی مشخصی ندارد.");
      return;
    }

    const fuelCost = Math.max(1, Math.ceil(driveSecs / 120)); // هر ۲ دقیقه = ۱٪

    if (vehicle.fuel_percent < fuelCost) {
      await ctx.reply(
        "سوخت این وسیله برای این مسیر کافی نیست.\n" +
          "اول در یک چاه فلوکس سوخت‌گیری کن.",
        { reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    const { data: destSpot, error: spotErr } = await supabase
      .from("spots")
      .select("id, title, region_id")
      .eq("id", edge.to_spot_id)
      .maybeSingle();

    if (spotErr || !destSpot) {
      console.error("veh:go destSpot error:", spotErr);
      await ctx.reply("مقصد این مسیر دیگر در جهان وجود ندارد.");
      return;
    }

    const { data: destRegion, error: regErr } = await supabase
      .from("regions")
      .select("id, title")
      .eq("id", destSpot.region_id)
      .maybeSingle();

    if (regErr || !destRegion) {
      console.error("veh:go destRegion error:", regErr);
      await ctx.reply("Region مقصد دیگر معتبر نیست.");
      return;
    }

    const now = new Date();
    const readyAt = new Date(now.getTime() + driveSecs * 1000);

    const { error: updCharErr } = await supabase
      .from("characters")
      .update({
        pending_region_id: destRegion.id,
        pending_spot_id: destSpot.id,
        travel_ready_at: readyAt.toISOString(),
        last_move_at: now.toISOString(),
        current_vehicle_id: vehicle.id,
      })
      .eq("id", char.id);

    if (updCharErr) {
      console.error("veh:go update character error:", updCharErr);
      await ctx.reply("در شروع سفر با وسیله مشکلی پیش آمد.");
      return;
    }

    const { error: updVehErr } = await supabase
      .from("vehicles")
      .update({
        current_region_id: destRegion.id,
        current_spot_id: destSpot.id,
        fuel_percent: vehicle.fuel_percent - fuelCost,
      })
      .eq("id", vehicle.id);

    if (updVehErr) {
      console.error("veh:go update vehicle error:", updVehErr);
      await ctx.reply("در ثبت حرکت وسیله مشکلی پیش آمد.");
      return;
    }

    const mins = Math.max(1, Math.round(driveSecs / 60));
    const kb = new InlineKeyboard()
      .text("رسیدم؟", "travel:arrive")
      .row()
      .text("🔙 منوی اصلی", "menu:main");

    await ctx.reply(
      "🚗 در حال حرکت با وسیله شدی…\n\n" +
        `• وسیله: ${vehicle.title}\n` +
        `• مقصد: ${destRegion.title} / ${destSpot.title}\n` +
        `• زمان تقریبی سفر: ${mins} دقیقه\n` +
        `• مصرف سوخت: ${fuelCost}%\n\n` +
        "هر وقت فکر کردی زمانش رسیده، «رسیدم؟» یا /arrive را بزن.",
      { reply_markup: kb }
    );
  });

  //
  // پیاده شدن از وسیله
  //
  bot.callbackQuery(/^veh:leave:(\d+)$/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const vehicleId = Number(ctx.match![1]);
    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.reply(errorText);
      return;
    }

    if (char.current_vehicle_id !== vehicleId) {
      await ctx.reply("الان سوار این وسیله نیستی.");
      return;
    }

    const { error: updErr } = await supabase
      .from("characters")
      .update({ current_vehicle_id: null })
      .eq("id", char.id);

    if (updErr) {
      console.error("veh:leave update error:", updErr);
      await ctx.reply("در پیاده شدن مشکلی پیش آمد.");
      return;
    }

    await ctx.reply("🚶 از وسیله پیاده شدی.", {
      reply_markup: mainMenuKeyboard(),
    });
  });

  //
  // TODO: ⛽ سوخت گیری (veh:fuel:...) بعداً وصل می‌شود
  //
}
