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
        "هنوز در اکلیس ثبت نشده‌ای.\nاز دستور «ثبت من» یا /start استفاده کن.",
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
 * فیچر حرکت پیاده + نقشه + /arrive
 */
export function registerTravelFeature(bot: Bot<MyContext>): void {
  //
  // 🗺 نقشه سریع من
  //
  async function showQuickMap(ctx: MyContext) {
    if (ctx.chat?.type !== "private") return;

    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.reply(errorText);
      return;
    }

    if (!char.current_region_id || !char.current_spot_id) {
      await ctx.reply(
        "مکان فعلی‌ات برای من نامشخص است.\n" +
          "باید ابتدا توسط ارباب با «ثبت پلیر» در یکی از Regionها ثبت شوی."
      );
      return;
    }

    const { data: region, error: regErr } = await supabase
      .from("regions")
      .select("title")
      .eq("id", char.current_region_id)
      .maybeSingle();

    const { data: spot, error: spotErr } = await supabase
      .from("spots")
      .select("title")
      .eq("id", char.current_spot_id)
      .maybeSingle();

    if (regErr || spotErr || !region || !spot) {
      console.error("showQuickMap region/spot error:", regErr || spotErr);
      await ctx.reply("در خواندن مکان فعلی‌ات مشکلی پیش آمد.");
      return;
    }

    const clan = char.clan_name ?? "بی‌خاندان";

    await ctx.reply(
      "🗺 نقشه سریع تو در اکلیس:\n\n" +
        `• خاندان: ${clan}\n` +
        `• Region فعلی: ${region.title}\n` +
        `• مکان فعلی: ${spot.title}\n\n` +
        "برای دیدن راه‌ها از «🧭 مسیر های من» استفاده کن.",
      { reply_markup: mainMenuKeyboard() }
    );
  }

  bot.command("mymap", showQuickMap);
  bot.hears("🗺 نقشه سریع من", showQuickMap);
  bot.callbackQuery("map:me", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showQuickMap(ctx);
  });

  //
  // 🧭 مسیر های من (پیاده)
  //
  async function openPaths(ctx: MyContext) {
    if (ctx.chat?.type !== "private") return;

    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.reply(errorText);
      return;
    }

    if (char.current_vehicle_id) {
      await ctx.reply(
        "الان سوار وسیله‌ای.\n" +
          "برای حرکت پیاده، باید اول از وسیله پیاده شوی.",
        { reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    if (!char.current_spot_id) {
      await ctx.reply(
        "مکان فعلی‌ات مشخص نیست.\n" +
          "ارباب باید با دستور «ثبت پلیر» در یک گروه Region لوکیشن اولیه‌ات را تنظیم کند."
      );
      return;
    }

    const { data: spot, error: spotErr } = await supabase
      .from("spots")
      .select("id, title, region_id")
      .eq("id", char.current_spot_id)
      .maybeSingle();

    if (spotErr || !spot) {
      console.error("openPaths spot error:", spotErr);
      await ctx.reply("در خواندن مکان فعلی‌ات مشکلی پیش آمد.");
      return;
    }

    const { data: region, error: regErr } = await supabase
      .from("regions")
      .select("title")
      .eq("id", spot.region_id)
      .maybeSingle();

    if (regErr || !region) {
      console.error("openPaths region error:", regErr);
      await ctx.reply("در خواندن Region فعلی‌ات مشکلی پیش آمد.");
      return;
    }

    const { data: edges, error: edgeErr } = await supabase
      .from("edges")
      .select("id, to_spot_id, travel_seconds")
      .eq("from_spot_id", spot.id);

    if (edgeErr) {
      console.error("openPaths edges error:", edgeErr);
      await ctx.reply("در خواندن مسیرهای اطراف مشکلی پیش آمد.");
      return;
    }

    if (!edges || edges.length === 0) {
      await ctx.reply(
        "در برابر این مکان، هیچ راهی در جهان تعریف نشده است.\n" +
          "ارباب باید از طریق «ساخت مسیر» راه‌ها را بسازد.",
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
      console.error("openPaths destSpots error:", destErr);
      await ctx.reply("در خواندن مقصدها مشکلی پیش آمد.");
      return;
    }

    const destMap = new Map<number, string>();
    for (const s of destSpots as any[]) destMap.set(s.id, s.title);

    const kb = new InlineKeyboard();
    for (const e of edges as any[]) {
      const name = destMap.get(e.to_spot_id) ?? `مقصد ${e.to_spot_id}`;
      const mins = Math.max(1, Math.round(e.travel_seconds / 60));
      kb.text(`➤ ${name} ~ ${mins} دقیقه`, `go:${e.id}`).row();
    }
    kb.text("🔙 منوی اصلی", "menu:main");

    await ctx.reply(
      "🧭 در برابر تو، این راه‌ها خودشان را آشکار می‌کنند:\n" +
        `• Region: ${region.title}\n` +
        `• مکان فعلی: ${spot.title}`,
      { reply_markup: kb }
    );
  }

  bot.command("path", openPaths);
  bot.hears("🧭 مسیر های من", openPaths);
  bot.callbackQuery("paths:open", async (ctx) => {
    await ctx.answerCallbackQuery();
    await openPaths(ctx);
  });

  //
  // شروع سفر پیاده از Edge
  //
  bot.callbackQuery(/^go:(\d+)$/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.answerCallbackQuery();
    const edgeId = Number(ctx.match![1]);
    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.reply(errorText);
      return;
    }

    if (char.current_vehicle_id) {
      await ctx.reply(
        "در حال حاضر سوار وسیله‌ای هستی.\n" +
          "برای حرکت پیاده باید اول پیاده شوی.",
        { reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    const { data: edge, error: edgeErr } = await supabase
      .from("edges")
      .select("id, from_spot_id, to_spot_id, travel_seconds")
      .eq("id", edgeId)
      .maybeSingle();

    if (edgeErr || !edge) {
      console.error("go edge error:", edgeErr);
      await ctx.reply("این مسیر دیگر وجود ندارد.");
      return;
    }

    if (char.current_spot_id !== edge.from_spot_id) {
      await ctx.reply(
        "الان در مبدأ این مسیر نیستی.\n" +
          "ابتدا نقشه‌ات را تازه کن و دوباره مسیر را انتخاب کن.",
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
      console.error("go destSpot error:", spotErr);
      await ctx.reply("مقصد این مسیر دیگر در جهان وجود ندارد.");
      return;
    }

    const { data: destRegion, error: regErr } = await supabase
      .from("regions")
      .select("id, title")
      .eq("id", destSpot.region_id)
      .maybeSingle();

    if (regErr || !destRegion) {
      console.error("go destRegion error:", regErr);
      await ctx.reply("Region مقصد دیگر معتبر نیست.");
      return;
    }

    const now = new Date();
    const readyAt = new Date(now.getTime() + edge.travel_seconds * 1000);

    const { error: updErr } = await supabase
      .from("characters")
      .update({
        pending_region_id: destRegion.id,
        pending_spot_id: destSpot.id,
        travel_ready_at: readyAt.toISOString(),
        last_move_at: now.toISOString(),
      })
      .eq("id", char.id);

    if (updErr) {
      console.error("go update character error:", updErr);
      await ctx.reply("در شروع سفر مشکلی پیش آمد.");
      return;
    }

    const mins = Math.max(1, Math.round(edge.travel_seconds / 60));
    const kb = new InlineKeyboard()
      .text("رسیدم؟", "travel:arrive")
      .row()
      .text("🔙 منوی اصلی", "menu:main");

    await ctx.reply(
      "🚶 در حال حرکت شدی…\n\n" +
        `• مقصد: ${destRegion.title} / ${destSpot.title}\n` +
        `• زمان تقریبی سفر: ${mins} دقیقه\n\n` +
        "هر وقت فکر کردی زمانش رسیده، دکمه‌ی «رسیدم؟» یا /arrive را بزن.",
      { reply_markup: kb }
    );
  });

  //
  // /arrive و travel:arrive (مشترک)
  //
  async function handleArrive(ctx: MyContext) {
    if (ctx.chat?.type !== "private") {
      return;
    }

    const { supabase } = ctx.services;
    const { char, errorText } = await getCharacterByTg(ctx);

    if (!char) {
      await ctx.reply(errorText);
      return;
    }

    if (!char.pending_region_id || !char.pending_spot_id || !char.travel_ready_at) {
      await ctx.reply(
        "الان در هیچ سفری نیستی.\n" +
          "برای حرکت از «🧭 مسیر های من» یا مسیرهای وسیله‌ات استفاده کن.",
        { reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    const now = new Date();
    const readyAt = new Date(char.travel_ready_at);

    if (now < readyAt) {
      const diffMs = readyAt.getTime() - now.getTime();
      const diffSec = Math.max(1, Math.round(diffMs / 1000));
      const mins = Math.max(1, Math.round(diffSec / 60));

      const kb = new InlineKeyboard()
        .text("🔁 دوباره چک کن", "travel:arrive")
        .row()
        .text("🔙 منوی اصلی", "menu:main");

      await ctx.reply(
        "⏳ هنوز به مقصد نرسیده‌ای…\n" +
          `حدوداً ${mins} دقیقه (≈ ${diffSec} ثانیه) دیگر باید صبر کنی.`,
        { reply_markup: kb }
      );
      return;
    }

    const { data: destRegion, error: regErr } = await supabase
      .from("regions")
      .select("id, title, telegram_chat_id")
      .eq("id", char.pending_region_id)
      .maybeSingle();

    const { data: destSpot, error: spotErr } = await supabase
      .from("spots")
      .select("id, title")
      .eq("id", char.pending_spot_id)
      .maybeSingle();

    if (regErr || spotErr || !destRegion || !destSpot) {
      console.error("arrive dest error:", regErr || spotErr);
      await ctx.reply("به مقصد رسیده‌ای، اما جهان در این نقطه دچار آشوب شده است.");
      return;
    }

    const prevRegionId = char.current_region_id;

    const { error: updErr } = await supabase
      .from("characters")
      .update({
        current_region_id: destRegion.id,
        current_spot_id: destSpot.id,
        pending_region_id: null,
        pending_spot_id: null,
        travel_ready_at: null,
      })
      .eq("id", char.id);

    if (updErr) {
      console.error("arrive update error:", updErr);
      await ctx.reply("در ثبت رسیدن به مقصد مشکلی پیش آمد.");
      return;
    }

    const kb = new InlineKeyboard().text("🔙 منوی اصلی", "menu:main");

    if (prevRegionId && prevRegionId !== destRegion.id && destRegion.telegram_chat_id) {
      try {
        const link = await ctx.api.createChatInviteLink(destRegion.telegram_chat_id);
        kb.row().url("ورود به گروه مقصد", link.invite_link);
      } catch (e) {
        console.error("createChatInviteLink error:", e);
      }
    }

    await ctx.reply(
      "✅ به مقصد رسیدی.\n\n" +
        `• Region: ${destRegion.title}\n` +
        `• مکان: ${destSpot.title}`,
      { reply_markup: kb }
    );
  }

  bot.command("arrive", handleArrive);
  bot.callbackQuery("travel:arrive", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleArrive(ctx);
  });

  //
  // منوی اصلی مشترک
  //
  bot.callbackQuery("menu:main", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("🔮 منوی اکلیس:", {
      reply_markup: mainMenuKeyboard(),
    });
  });
}
