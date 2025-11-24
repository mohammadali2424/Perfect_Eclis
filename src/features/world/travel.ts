import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";

async function ensureCharacter(ctx: MyContext) {
  const { supabase } = ctx.services;
  const tgId = ctx.from!.id;

  const { data: char, error } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", tgId)
    .maybeSingle();

  if (error) {
    console.error("characters select error:", error);
  }

  if (char) return char;

  // اگر کاراکتر تو دیتابیس نبود، یک رکورد خالی می‌سازیم
  const { data: inserted, error: insErr } = await supabase
    .from("characters")
    .insert({
      tg_id: tgId,
      char_name: null,
      current_region_id: null,
      current_spot_id: null,
      last_move_at: null,
      travel_ready_at: null,
      pending_region_id: null,
      pending_spot_id: null
    })
    .select("*")
    .single();

  if (insErr || !inserted) {
    console.error("characters insert error:", insErr);
    throw new Error("cannot init character");
  }

  return inserted;
}

async function showPaths(ctx: MyContext) {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("برای دیدن مسیرهات بیا پی‌وی من.");
    return;
  }

  const { supabase } = ctx.services;
  const char = await ensureCharacter(ctx);

  if (!char.current_spot_id) {
    await ctx.reply(
      "هنوز تو هیچ لوکیشنی قرار نگرفتی.\n" +
        "ارباب باید لوکیشن اولیه‌ات رو توی دیتابیس تنظیم کنه (current_region_id / current_spot_id)."
    );
    return;
  }

  // گرفتن Spot فعلی
  const { data: spot, error: spotErr } = await supabase
    .from("spots")
    .select("id,title,region_id")
    .eq("id", char.current_spot_id)
    .single();

  if (spotErr || !spot) {
    await ctx.reply("لوکیشن فعلی‌ات در دیتابیس پیدا نشد.");
    return;
  }

  // گرفتن Region فعلی
  const { data: region, error: regErr } = await supabase
    .from("regions")
    .select("id,title")
    .eq("id", spot.region_id)
    .single();

  if (regErr || !region) {
    await ctx.reply("Region فعلی‌ات پیدا نشد.");
    return;
  }

  // گرفتن Edgeهای خروجی از این Spot
  const { data: edges, error: edgeErr } = await supabase
    .from("edges")
    .select("id,from_spot_id,to_spot_id,travel_seconds")
    .eq("from_spot_id", spot.id);

  if (edgeErr) {
    console.error("edges select error:", edgeErr);
    await ctx.reply("در خواندن مسیرها خطایی رخ داد.");
    return;
  }

  if (!edges || edges.length === 0) {
    await ctx.reply(
      `مکان فعلی:\n${region.title} / ${spot.title}\n\n` +
        "هیچ مسیری از اینجا تعریف نشده. ارباب باید Edge بسازد."
    );
    return;
  }

  // اسم مقصدها
  const toIds = edges.map((e: any) => e.to_spot_id);
  const { data: destSpots, error: destErr } = await supabase
    .from("spots")
    .select("id,title")
    .in("id", toIds);

  if (destErr || !destSpots) {
    await ctx.reply("در خواندن مقصدها خطایی رخ داد.");
    return;
  }

  const destMap = new Map<number, string>();
  for (const d of destSpots) {
    destMap.set(d.id, d.title);
  }

  const kb = new InlineKeyboard();
  for (const e of edges) {
    const destTitle = destMap.get(e.to_spot_id) || `Spot ${e.to_spot_id}`;
    const label = `${destTitle} (${e.travel_seconds}s)`;
    kb.text(label, `go:${e.id}`).row();
  }
  kb.text("🔄 تازه‌سازی", "paths:open");

  await ctx.reply(
    `مکان فعلی:\n${region.title} / ${spot.title}\n\n` +
      "مقصدهای در دسترس:",
    { reply_markup: kb }
  );
}

export function registerTravelFeature(bot: Bot<MyContext>) {
  // /path برای سازگاری، ولی تمرکز روی دکمه‌ی «مسیرهای من»
  bot.command("path", async (ctx) => {
    await showPaths(ctx);
  });

  // دکمه‌ی «مسیرهای من»
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    if (data === "paths:open") {
      await ctx.answerCallbackQuery();
      await showPaths(ctx);
      return;
    }

    await next();
  });

  // شروع سفر با دکمه‌ی مقصد
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    if (!data.startsWith("go:")) {
      await next();
      return;
    }

    await ctx.answerCallbackQuery();

    const edgeId = Number(data.split(":")[1]);
    if (!Number.isFinite(edgeId)) return;

    const { supabase } = ctx.services;
    const char = await ensureCharacter(ctx);

    // خواندن Edge
    const { data: edge, error: edgeErr } = await supabase
      .from("edges")
      .select("id,from_spot_id,to_spot_id,travel_seconds")
      .eq("id", edgeId)
      .single();

    if (edgeErr || !edge) {
      await ctx.reply("این مسیر دیگر وجود ندارد.");
      return;
    }

    // Spot مقصد + Region مقصد
    const { data: destSpot, error: destSpotErr } = await supabase
      .from("spots")
      .select("id,title,region_id")
      .eq("id", edge.to_spot_id)
      .single();

    if (destSpotErr || !destSpot) {
      await ctx.reply("مقصد این مسیر پیدا نشد.");
      return;
    }

    const { data: destRegion, error: destRegErr } = await supabase
      .from("regions")
      .select("id,title")
      .eq("id", destSpot.region_id)
      .single();

    if (destRegErr || !destRegion) {
      await ctx.reply("Region مقصد پیدا نشد.");
      return;
    }

    const now = new Date();
    const ready = new Date(
      now.getTime() + edge.travel_seconds * 1000
    ).toISOString();

    const { error: updErr } = await supabase
      .from("characters")
      .update({
        pending_region_id: destRegion.id,
        pending_spot_id: destSpot.id,
        travel_ready_at: ready,
        last_move_at: now.toISOString()
      })
      .eq("tg_id", ctx.from!.id);

    if (updErr) {
      console.error("characters update error:", updErr);
      await ctx.reply("خطا در شروع سفر.");
      return;
    }

    const kb = new InlineKeyboard().text("رسیدم؟", "travel:arrive");

    await ctx.reply(
      `در حال حرکت به سمت:\n${destRegion.title} / ${destSpot.title}\n` +
        `زمان تقریبی سفر: ${edge.travel_seconds} ثانیه.\n\n` +
        "بعد از اتمام زمان، روی «رسیدم؟» بزن یا از /arrive استفاده کن.",
      { reply_markup: kb }
    );
  });

  async function handleArrive(ctx: MyContext) {
    if (ctx.chat?.type !== "private") {
      await ctx.reply("برای تکمیل سفر، بیا پی‌وی من و /arrive بزن.");
      return;
    }

    const { supabase } = ctx.services;
    const char = await ensureCharacter(ctx);

    if (!char.pending_region_id || !char.pending_spot_id || !char.travel_ready_at) {
      await ctx.reply("الان در حال سفر نیستی.");
      return;
    }

    const now = new Date();
    const ready = new Date(char.travel_ready_at);

    if (now < ready) {
      const diffMs = ready.getTime() - now.getTime();
      const diffSec = Math.ceil(diffMs / 1000);
      await ctx.reply(
        `هنوز به مقصد نرسیدی.\n` +
          `زمان باقی‌مانده: حدود ${diffSec} ثانیه.`
      );
      return;
    }

    // گرفتن مقصد
    const { data: destSpot, error: destSpotErr } = await supabase
      .from("spots")
      .select("id,title,region_id")
      .eq("id", char.pending_spot_id)
      .single();

    if (destSpotErr || !destSpot) {
      await ctx.reply("مقصد در دیتابیس پیدا نشد.");
      return;
    }

    const { data: destRegion, error: destRegErr } = await supabase
      .from("regions")
      .select("id,title,telegram_chat_id")
      .eq("id", destSpot.region_id)
      .single();

    if (destRegErr || !destRegion) {
      await ctx.reply("Region مقصد پیدا نشد.");
      return;
    }

    const oldRegionId = char.current_region_id;

    // آپدیت وضعیت کاراکتر
    const { error: updErr } = await supabase
      .from("characters")
      .update({
        current_region_id: destRegion.id,
        current_spot_id: destSpot.id,
        pending_region_id: null,
        pending_spot_id: null,
        travel_ready_at: null
      })
      .eq("tg_id", ctx.from!.id);

    if (updErr) {
      console.error("characters arrive update error:", updErr);
      await ctx.reply("خطا در ثبت رسیدن به مقصد.");
      return;
    }

    // اینجا فعلاً فقط پیام رسیدن می‌دیم
    // کیک‌کردن از گروه قبلی + لینک گروه جدید رو بعداً اضافه می‌کنیم.
    await ctx.reply(
      `به مقصد رسیدی!\n` +
        `${destRegion.title} / ${destSpot.title}`
    );
  }

  // /arrive
  bot.command("arrive", async (ctx) => {
    await handleArrive(ctx);
  });

  // دکمه‌ی «رسیدم؟»
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    if (data === "travel:arrive") {
      await ctx.answerCallbackQuery();
      await handleArrive(ctx);
      return;
    }
    await next();
  });
}
