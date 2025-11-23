import { Bot, InlineKeyboard } from "grammy";
import { MyContext, CharacterState } from "../../core/types";
import { MASTER_ID } from "../../core/config";

// ----------------- Helper: load or create character row -----------------

async function getOrCreateCharacter(ctx: MyContext): Promise<CharacterState> {
  const { supabase } = ctx.services;
  const tgId = ctx.from!.id;

  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", tgId)
    .single();

  // PGRST116 = no rows
  if (error && error.code !== "PGRST116") {
    console.error("Supabase error get character", error);
  }

  if (!data) {
    const char: CharacterState = {
      tg_id: tgId,
      char_name: null,
      current_region_id: null,
      current_spot_id: null,
      last_move_at: null,
      travel_ready_at: null,
    };
    const { error: insertError } = await supabase.from("characters").insert(char);
    if (insertError) {
      console.error("Supabase error insert character", insertError);
    }
    return char;
  }

  return data as CharacterState;
}

// ----------------- Helper: set character location instantly -----------------

async function setCharacterLocationBySpotSlug(
  ctx: MyContext,
  spotSlug: string
): Promise<{ ok: boolean; message: string }> {
  const { supabase } = ctx.services;
  const char = await getOrCreateCharacter(ctx);

  // پیدا کردن spot با slug
  const { data: spot, error: spotError } = await supabase
    .from("spots")
    .select("id, region_id, title")
    .eq("slug", spotSlug)
    .single();

  if (spotError || !spot) {
    console.error("setCharacterLocationBySpotSlug spot error", spotError);
    return { ok: false, message: "چنین لوکیشنی (spot) با این slug پیدا نشد." };
  }

  // پیدا کردن region برای ذخیره‌ی chat_id قبلی
  const { data: region, error: regionError } = await supabase
    .from("regions")
    .select("id, telegram_chat_id")
    .eq("id", spot.region_id)
    .single();

  if (regionError || !region) {
    console.error("setCharacterLocationBySpotSlug region error", regionError);
    return { ok: false, message: "منطقه‌ی مربوط به این spot پیدا نشد." };
  }

  const nowIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("characters")
    .update({
      current_region_id: spot.region_id,
      current_spot_id: spot.id,
      last_move_at: nowIso,
      travel_ready_at: null,
      pending_region_id: null,
      pending_spot_id: null,
      last_region_chat_id: region.telegram_chat_id, // آخرین چت منطقه فعلی
    })
    .eq("tg_id", char.tg_id);

  if (updateError) {
    console.error("setCharacterLocationBySpotSlug update error", updateError);
    return { ok: false, message: "در ذخیره‌سازی موقعیت کاراکتر مشکلی پیش آمد." };
  }

  return { ok: true, message: `موقعیتت روی «${spot.title}» تنظیم شد.` };
}

// ----------------- Feature registration -----------------

export function registerTravelFeature(bot: Bot<MyContext>) {
  // فقط ارباب بتونه موقعیت کاراکترها رو دستی تنظیم کنه
  // /setpos <spot_slug>
  bot.command("setpos", async (ctx) => {
    if (!ctx.from) return;

    if (ctx.from.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم میتونه همچین کاری بکنه، حدتو بدون.");
      return;
    }

    const parts = ctx.message!.text.trim().split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply("استفاده: /setpos <spot_slug>");
      return;
    }

    const slug = parts[1];
    const result = await setCharacterLocationBySpotSlug(ctx, slug);
    await ctx.reply(result.message);
  });

  // /path — دیدن موقعیت فعلی و مسیرهای خروجی
  bot.command("path", async (ctx) => {
    if (!ctx.from) return;
    const char = await getOrCreateCharacter(ctx);

    if (!char.current_region_id || !char.current_spot_id) {
      await ctx.reply(
        "هنوز در هیچ جای جهان اکلیس قرار نگرفتی.\n" +
          "ارباب باید با /setpos نقطه‌ی شروع رو برات تنظیم کنه."
      );
      return;
    }

    const { supabase } = ctx.services;

    // گرفتن خود spot فعلی
    const { data: spot, error: spotError } = await supabase
      .from("spots")
      .select("id, title")
      .eq("id", char.current_spot_id)
      .single();

    if (spotError || !spot) {
      console.error("path spot error", spotError);
      await ctx.reply("نتونستم موقعیت فعلیت رو پیدا کنم. با اربابم صحبت کن.");
      return;
    }

    // گرفتن همه‌ی edgeهای خروجی از این spot
    const { data: edges, error: edgeError } = await supabase
      .from("edges")
      .select("id, to_spot_id, travel_seconds")
      .eq("from_spot_id", char.current_spot_id);

    if (edgeError) {
      console.error("path edges error", edgeError);
      await ctx.reply("در حال حاضر مسیرها در دسترس نیستن.");
      return;
    }

    let text = `📍 موقعیت فعلی:\n${spot.title}\n\n`;
    text += "مسیرهای قابل حرکت:";

    const kb = new InlineKeyboard();

    if (!edges || edges.length === 0) {
      text += "\n(هیچ مسیری در این نقطه ثبت نشده است.)";
      await ctx.reply(text);
      return;
    }

    // برای گرفتن نام مقصدها، همه‌ی to_spot_id ها رو جمع می‌کنیم
    const toIds = (edges as any[]).map((e) => e.to_spot_id);
    const { data: toSpots, error: toSpotError } = await supabase
      .from("spots")
      .select("id, title")
      .in("id", toIds);

    if (toSpotError) {
      console.error("path toSpots error", toSpotError);
      await ctx.reply("در حال حاضر مقصدها در دسترس نیستند.");
      return;
    }

    const titleMap = new Map<string, string>();
    for (const s of toSpots || []) {
      titleMap.set(s.id, s.title);
    }

    for (const edge of edges as any[]) {
      const destTitle = titleMap.get(edge.to_spot_id) || "مسیر بعدی";
      const label =
        edge.travel_seconds && edge.travel_seconds > 0
          ? `رفتن به ${destTitle} (${edge.travel_seconds}s)`
          : `رفتن به ${destTitle}`;
      kb.text(label, `move:${edge.id}`).row();
    }

    await ctx.reply(text, { reply_markup: kb });
  });

  // کلیک روی دکمه‌ی حرکت
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    if (!data.startsWith("move:")) {
      await next();
      return;
    }

    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }

    const edgeId = Number(data.split(":")[1]);
    if (Number.isNaN(edgeId)) {
      await ctx.answerCallbackQuery();
      return;
    }

    const { supabase } = ctx.services;
    const char = await getOrCreateCharacter(ctx);

    if (!char.current_region_id || !char.current_spot_id) {
      await ctx.answerCallbackQuery({
        text: "اول باید یک موقعیت فعلی داشته باشی. با ارباب هماهنگ کن.",
        show_alert: true,
      });
      return;
    }

    // گرفتن edge
    const { data: edge, error: edgeError } = await supabase
      .from("edges")
      .select("id, from_spot_id, to_spot_id, travel_seconds")
      .eq("id", edgeId)
      .single();

    if (edgeError || !edge) {
      console.error("move edge error", edgeError);
      await ctx.answerCallbackQuery({
        text: "مسیر نامعتبر است.",
        show_alert: true,
      });
      return;
    }

    // امنیت: چک کنیم کاربر واقعا از همون from_spot حرکت می‌کنه
    if (edge.from_spot_id !== char.current_spot_id) {
      await ctx.answerCallbackQuery({
        text: "الان در این نقطه نیستی که از این مسیر حرکت کنی.",
        show_alert: true,
      });
      return;
    }

    // گرفتن مقصد (spot و region)
    const { data: destSpot, error: destSpotError } = await supabase
      .from("spots")
      .select("id, title, region_id")
      .eq("id", edge.to_spot_id)
      .single();

    if (destSpotError || !destSpot) {
      console.error("move destSpot error", destSpotError);
      await ctx.answerCallbackQuery({
        text: "مقصد این مسیر پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    const { data: destRegion, error: destRegionError } = await supabase
      .from("regions")
      .select("id, telegram_chat_id")
      .eq("id", destSpot.region_id)
      .single();

    if (destRegionError || !destRegion) {
      console.error("move destRegion error", destRegionError);
      await ctx.answerCallbackQuery({
        text: "منطقه‌ی مقصد پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    // گرفتن region فعلی برای ذخیره‌ی chat_id جهت کیک
    let currentRegionChatId: bigint | null = null;
    if (char.current_region_id) {
      const { data: curRegion, error: curRegionError } = await supabase
        .from("regions")
        .select("id, telegram_chat_id")
        .eq("id", char.current_region_id)
        .single();

      if (curRegionError) {
        console.error("move curRegion error", curRegionError);
      } else if (curRegion) {
        currentRegionChatId = curRegion.telegram_chat_id;
      }
    }

    const travelSeconds: number = edge.travel_seconds || 0;
    const now = Date.now();
    const readyAt = new Date(now + travelSeconds * 1000).toISOString();

    // ذخیره‌ی مقصد و تایمر در characters
    const { error: updateError } = await supabase
      .from("characters")
      .update({
        travel_ready_at: readyAt,
        pending_region_id: destSpot.region_id,
        pending_spot_id: destSpot.id,
        last_region_chat_id: currentRegionChatId,
      })
      .eq("tg_id", char.tg_id);

    if (updateError) {
      console.error("move update character travel error", updateError);
      await ctx.answerCallbackQuery({
        text: "خطایی در شروع حرکت رخ داد.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.reply(
      travelSeconds > 0
        ? `حرکتت به سمت «${destSpot.title}» شروع شد.\nزمان تقریبی سفر: ${travelSeconds} ثانیه.\nبعد از پایان، دستور /arrive را بزن تا دروازه‌ی مقصد برات باز بشه.`
        : `این مسیر تقریبا آنی است.\nدستور /arrive را بزن تا دروازه‌ی مقصد برات باز بشه.`
    );
  });

  // /arrive — چک کردن رسیدن و ارسال لینک + کیک از منطقه قبلی
  bot.command("arrive", async (ctx) => {
    if (!ctx.from) return;
    const { supabase } = ctx.services;
    const char = await getOrCreateCharacter(ctx);

    if (!char.travel_ready_at || !char.tg_id) {
      await ctx.reply("در حال حاضر در حال سفری نیستی که به مقصد رسیده باشی.");
      return;
    }

    const now = Date.now();
    const readyAtMs = Date.parse(char.travel_ready_at);

    if (Number.isNaN(readyAtMs)) {
      await ctx.reply("اطلاعات سفر خراب است. با اربابم صحبت کن.");
      return;
    }

    if (now < readyAtMs) {
      const diffSec = Math.ceil((readyAtMs - now) / 1000);
      await ctx.reply(`هنوز به مقصد نرسیدی. حدود ${diffSec} ثانیه دیگر باقی مانده است.`);
      return;
    }

    if (!char.pending_region_id || !char.pending_spot_id) {
      await ctx.reply("مقصد این سفر مشخص نیست. با اربابم صحبت کن.");
      return;
    }

    // گرفتن region مقصد برای لینک
    const { data: destRegion, error: destRegionError } = await supabase
      .from("regions")
      .select("id, telegram_chat_id, title")
      .eq("id", char.pending_region_id)
      .single();

    if (destRegionError || !destRegion) {
      console.error("arrive destRegion error", destRegionError);
      await ctx.reply("منطقه‌ی مقصد پیدا نشد.");
      return;
    }

    // گرفتن spot مقصد برای نمایش نام
    const { data: destSpot, error: destSpotError } = await supabase
      .from("spots")
      .select("id, title")
      .eq("id", char.pending_spot_id)
      .single();

    if (destSpotError || !destSpot) {
      console.error("arrive destSpot error", destSpotError);
      await ctx.reply("لوکیشن مقصد پیدا نشد.");
      return;
    }

    // ساخت لینک دعوت برای گروه مقصد
    let inviteLink: string | null = null;
    try {
      inviteLink = await ctx.api.exportChatInviteLink(destRegion.telegram_chat_id);
    } catch (e) {
      console.error("exportChatInviteLink error", e);
    }

    // آپدیت کاراکتر: رسیدن به مقصد
    const nowIso = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("characters")
      .update({
        current_region_id: destRegion.id,
        current_spot_id: destSpot.id,
        last_move_at: nowIso,
        travel_ready_at: null,
        pending_region_id: null,
        pending_spot_id: null,
      })
      .eq("tg_id", char.tg_id);

    if (updateError) {
      console.error("arrive update character error", updateError);
      await ctx.reply("در ذخیره‌سازی وضعیت رسیدن مشکلی پیش آمد.");
      return;
    }

    // اگر last_region_chat_id ست شده بود، از آن گروه کیکش می‌کنیم (ban+unban تا دائمی بن نشود)
    if (char.last_region_chat_id) {
      try {
        await ctx.api.banChatMember(char.last_region_chat_id, ctx.from.id);
        await ctx.api.unbanChatMember(char.last_region_chat_id, ctx.from.id);
      } catch (e) {
        console.error("kick from previous region error", e);
      }

      // پاک کردن last_region_chat_id در DB
      const { error: clearPrevError } = await supabase
        .from("characters")
        .update({ last_region_chat_id: null })
        .eq("tg_id", char.tg_id);

      if (clearPrevError) {
        console.error("clear last_region_chat_id error", clearPrevError);
      }
    }

    // ساخت دکمه‌ی ورود به منطقه‌ی جدید
    const kb = new InlineKeyboard();
    if (inviteLink) {
      kb.url(`ورود به ${destRegion.title}`, inviteLink);
    }

    await ctx.reply(
      `به مقصد رسیدی.\nلوکیشن فعلی: «${destSpot.title}» در منطقه‌ی «${destRegion.title}».` +
        (inviteLink ? "\nاز دکمه‌ی زیر برای ورود به گروه این منطقه استفاده کن." : ""),
      inviteLink ? { reply_markup: kb } : undefined
    );
  });
}
