import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

/**
 * ساخت یا برگرداندن رکورد کاراکتر برای یک tg_id خاص
 */
async function ensureCharacterFor(ctx: MyContext, tgId: number) {
  const { supabase } = ctx.services;

  const { data: char, error } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", tgId)
    .maybeSingle();

  if (!error && char) return char;

  const { data: inserted, error: insErr } = await supabase
    .from("characters")
    .insert({
      tg_id: tgId,
      char_name: null,
      clan_name: null,
      current_region_id: null,
      current_spot_id: null,
      last_move_at: null,
      travel_ready_at: null,
      pending_region_id: null,
      pending_spot_id: null,
    })
    .select("*")
    .single();

  if (insErr || !inserted) {
    console.error("characters insert error:", insErr);
    throw new Error("cannot init character");
  }

  return inserted;
}

/**
 * نسخه‌ی راحت‌تر برای خود کاربر
 */
async function ensureCharacter(ctx: MyContext) {
  const tgId = ctx.from!.id;
  return ensureCharacterFor(ctx, tgId);
}

/**
 * گرفتن Region بر اساس chat_id گروه
 */
async function getRegionByChatId(ctx: MyContext, chatId: number) {
  const { supabase } = ctx.services;
  const { data, error } = await supabase
    .from("regions")
    .select("*")
    .eq("telegram_chat_id", chatId)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * نمایش مسیرهای قابل دسترس از لوکیشن فعلی کاربر
 */
async function showPaths(ctx: MyContext) {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("برای دیدن «مسیر های من» بیا توی پی‌وی بات.");
    return;
  }

  const { supabase } = ctx.services;
  const char = await ensureCharacter(ctx);

  if (!char.current_spot_id) {
    await ctx.reply(
      "هنوز لوکیشن اولیه‌ای برایت ثبت نشده.\n" +
        "ارباب باید با دستور /regplayer توی یکی از گروه‌ها، تو رو ثبت کنه."
    );
    return;
  }

  // Spot فعلی
  const { data: spot, error: spotErr } = await supabase
    .from("spots")
    .select("id,title,region_id")
    .eq("id", char.current_spot_id)
    .single();

  if (spotErr || !spot) {
    await ctx.reply("لوکیشن فعلی‌ات در دیتابیس پیدا نشد.");
    return;
  }

  // Region فعلی
  const { data: region, error: regErr } = await supabase
    .from("regions")
    .select("id,title")
    .eq("id", spot.region_id)
    .single();

  if (regErr || !region) {
    await ctx.reply("Region فعلی‌ات در دیتابیس پیدا نشد.");
    return;
  }

  // Edgeهای خروجی از این Spot
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
        "از این نقطه هیچ مسیری تعریف نشده.\n" +
        "ارباب باید از پنل /worldadmin برای این Spot Edge بسازد."
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

/**
 * ثبت پلیر با ریپلای /regplayer
 */
async function handleRegPlayer(ctx: MyContext) {
  if (ctx.from?.id !== MASTER_ID) {
    await ctx.reply("فقط اربابم میتونه پلیر ثبت کنه، حدتو بدون.");
    return;
  }

  if (!ctx.chat || ctx.chat.type === "private") {
    await ctx.reply("دستور /regplayer رو باید داخل گروه و روی پیام پلیر بزنی (ریپلای).");
    return;
  }

  const reply = ctx.message?.reply_to_message;
  if (!reply || !reply.from) {
    await ctx.reply("برای ثبت پلیر، باید روی پیام اون شخص ریپلای کنی و بعد /regplayer رو بفرستی.");
    return;
  }

  const target = reply.from;
  const chatId = ctx.chat.id;
  const { supabase } = ctx.services;

  // Region مربوط به این گروه
  const region = await getRegionByChatId(ctx, chatId);
  if (!region) {
    await ctx.reply(
      "برای این گروه هنوز Region ثبت نشده.\n" +
        "اول داخل همین گروه /worldadmin رو بزن و از پنل، Region این چت رو بساز."
    );
    return;
  }

  // پیدا کردن یک Spot پیش‌فرض (اولین Spot در این Region)
  const { data: spots, error: spErr } = await supabase
    .from("spots")
    .select("id,title")
    .eq("region_id", region.id)
    .order("id", { ascending: true })
    .limit(1);

  if (spErr || !spots || spots.length === 0) {
    await ctx.reply(
      "برای این Region هنوز هیچ Spotی تعریف نشده.\n" +
        "از پنل /worldadmin → «ساخت Spot» رو بزن، بعد دوباره /regplayer رو اجرا کن."
    );
    return;
  }

  const spot = spots[0];

  // آیا کاراکتر قبلاً وجود دارد؟
  const { data: existing, error: charErr } = await supabase
    .from("characters")
    .select("id")
    .eq("tg_id", target.id)
    .maybeSingle();

  // اگر کوئری خطا داد، فقط لاگ بگیر و ادامه بده
  if (charErr) {
    console.error("characters check error:", charErr);
  }

  if (existing && !charErr) {
    // آپدیت لوکیشن
    const { error: updErr } = await supabase
      .from("characters")
      .update({
        current_region_id: region.id,
        current_spot_id: spot.id,
        pending_region_id: null,
        pending_spot_id: null,
        travel_ready_at: null,
      })
      .eq("tg_id", target.id);

    if (updErr) {
      console.error("characters update error:", updErr);
      await ctx.reply("در آپدیت لوکیشن پلیر خطایی رخ داد.");
      return;
    }
  } else {
    // ساخت کاراکتر جدید
    const { error: insErr } = await supabase.from("characters").insert({
      tg_id: target.id,
      char_name: null,
      clan_name: null,
      current_region_id: region.id,
      current_spot_id: spot.id,
      last_move_at: null,
      travel_ready_at: null,
      pending_region_id: null,
      pending_spot_id: null,
    });

    if (insErr) {
      console.error("characters insert error:", insErr);
      await ctx.reply("در ساخت پلیر جدید خطایی رخ داد.");
      return;
    }
  }

  await ctx.reply(
    `پلیر ثبت شد ✅\n` +
      `کاربر: ${target.first_name}${
        target.username ? ` (@${target.username})` : ""
      }\n` +
      `مکان اولیه: ${region.title} / ${spot.title}`
  );
}

/**
 * هندل رسیدن به مقصد + کیک از گروه قبلی + لینک ورود به گروه جدید
 */
async function handleArrive(ctx: MyContext) {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("برای تکمیل سفر، بیا توی پی‌وی من و /arrive بزن.");
    return;
  }

  const { supabase } = ctx.services;
  const char = await ensureCharacter(ctx);

  if (
    !char.pending_region_id ||
    !char.pending_spot_id ||
    !char.travel_ready_at
  ) {
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
        `زمان تقریبی باقی‌مانده: حدود ${diffSec} ثانیه.`
    );
    return;
  }

  // مقصد
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

  // آپدیت وضعیت کاراکتر به مقصد جدید (قبل از لاجیک تلگرام)
  const { error: updErr } = await supabase
    .from("characters")
    .update({
      current_region_id: destRegion.id,
      current_spot_id: destSpot.id,
      pending_region_id: null,
      pending_spot_id: null,
      travel_ready_at: null,
    })
    .eq("tg_id", ctx.from!.id);

  if (updErr) {
    console.error("characters arrive update error:", updErr);
    await ctx.reply("خطا در ثبت رسیدن به مقصد.");
    return;
  }

  // حالا بخش تلگرام: اگر Region عوض شده و هر دو گروه تنظیم شده‌اند → کیک + لینک
  let extraText = "";
  let kb: InlineKeyboard | undefined = undefined;

  if (oldRegionId && oldRegionId !== destRegion.id) {
    try {
      // گرفتن اطلاعات Region قبلی برای پیدا کردن chat_id
      const { data: oldRegion, error: oldRegErr } = await supabase
        .from("regions")
        .select("id,title,telegram_chat_id")
        .eq("id", oldRegionId)
        .single();

      const oldChatId = oldRegion?.telegram_chat_id;
      const newChatId = destRegion.telegram_chat_id;

      // اگر chat_id قدیم و جدید موجود باشند، تلاش برای کیک + لینک
      if (!oldRegErr && oldChatId && newChatId) {
        // کیک نرم: ban + unban
        try {
          await ctx.api.banChatMember(oldChatId, ctx.from!.id);
          await ctx.api.unbanChatMember(oldChatId, ctx.from!.id);
        } catch (kickErr) {
          console.error("kick from old chat error:", kickErr);
          extraText +=
            "\n⚠️ نتونستم از گروه قبلی کیکت کنم (احتمالاً ادمین‌بودن یا پرمیشن کم دارم).";
        }

        // ساخت لینک دعوت گروه جدید
        try {
          const invite = await ctx.api.createChatInviteLink(newChatId, {
            creates_join_request: false,
          });

          kb = new InlineKeyboard().url(
            "ورود به مکان جدید",
            invite.invite_link
          );
        } catch (invErr) {
          console.error("create invite link error:", invErr);
          extraText +=
            "\n⚠️ نتونستم لینک ورود به گروه مقصد رو بسازم (احتمالاً دسترسی ساخت لینک ندارم).";
        }
      } else {
        extraText +=
          "\n⚠️ برای یکی از Regionها chat_id ثبت نشده؛ امکان مدیریت گروه‌ها وجود نداره.";
      }
    } catch (err) {
      console.error("old region / telegram handling error:", err);
      extraText += "\n⚠️ در مدیریت گروه‌های تلگرام خطایی رخ داد.";
    }
  }

  // پیام نهایی
  const baseText =
    `به مقصد رسیدی! ✅\n` +
    `${destRegion.title} / ${destSpot.title}`;

  await ctx.reply(baseText + extraText, {
    reply_markup: kb,
  });
}

export function registerTravelFeature(bot: Bot<MyContext>) {
  // دکمه‌ی ریپلای‌کیبورد: «🧭 مسیر های من»
  bot.hears("🧭 مسیر های من", async (ctx) => {
    await showPaths(ctx);
  });

  // برای سازگاری: /path هم همون کار «مسیر های من» رو می‌کند
  bot.command("path", async (ctx) => {
    await showPaths(ctx);
  });

  // دستور ثبت پلیر (فقط ارباب، فقط روی ریپلای توی گروه)
  bot.command("regplayer", async (ctx) => {
    await handleRegPlayer(ctx);
  });

  // دکمه‌ی inline برای باز کردن دوباره لیست مسیرها
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    if (data === "paths:open") {
      await ctx.answerCallbackQuery();
      await showPaths(ctx);
      return;
    }
    await next();
  });

  // شروع سفر روی دکمه‌ی مقصد: go:<edgeId>
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    if (!data.startsWith("go:")) {
      await next();
      return;
    }

    await ctx.answerCallbackQuery();

    const edgeId = Number(data.split(":")[1]);
    if (!Number.isFinite(edgeId)) {
      return;
    }

    const { supabase } = ctx.services;
    const char = await ensureCharacter(ctx);

    // پیدا کردن Edge
    const { data: edge, error: edgeErr } = await supabase
      .from("edges")
      .select("id,from_spot_id,to_spot_id,travel_seconds")
      .eq("id", edgeId)
      .single();

    if (edgeErr || !edge) {
      await ctx.reply("این مسیر دیگر وجود ندارد.");
      return;
    }

    // مقصد این Edge
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
    const ready = new Date(now.getTime() + edge.travel_seconds * 1000);

    const { error: updErr } = await supabase
      .from("characters")
      .update({
        pending_region_id: destRegion.id,
        pending_spot_id: destSpot.id,
        travel_ready_at: ready.toISOString(),
        last_move_at: now.toISOString(),
      })
      .eq("tg_id", char.tg_id);

    if (updErr) {
      console.error("characters start travel update error:", updErr);
      await ctx.reply("در شروع سفر خطایی رخ داد.");
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

  // /arrive برای تکمیل سفر
  bot.command("arrive", async (ctx) => {
    await handleArrive(ctx);
  });

  // دکمه‌ی inline «رسیدم؟»
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
