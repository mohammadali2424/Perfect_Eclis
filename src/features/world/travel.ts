import { Bot, InlineKeyboard } from "grammy";
import { MyContext, CharacterState } from "../../core/types";

// کمکی: لود یا ساخت کاراکتر
async function getOrCreateCharacter(ctx: MyContext): Promise<CharacterState> {
  const { supabase } = ctx.services;
  const tgId = ctx.from!.id;

  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", tgId)
    .single();

  // اگر اررور از نوع "هیچ ردیفی نیست" باشه، Supabase معمولاً status 406 / 404 می‌ده
  if (error && error.code !== "PGRST116") {
    // فقط لاگ می‌کنیم، چون ممکنه فقط "no rows" باشه
    console.log("Supabase get character error:", error.message);
  }

  if (!data) {
    const emptyChar: CharacterState = {
      tg_id: tgId,
      char_name: null,
      current_region_id: null,
      current_spot_id: null,
      last_move_at: null,
      travel_ready_at: null,
      pending_region_id: null,
      pending_spot_id: null,
    };
    const { error: insertError } = await supabase
      .from("characters")
      .insert(emptyChar);
    if (insertError) {
      console.error("Supabase insert character error:", insertError);
    }
    return emptyChar;
  }

  return data as CharacterState;
}

// کمکی: اگر کاراکتر مکان نداشت، سعی می‌کنیم یک spot دیفالت پیدا کنیم
async function ensureCharacterHasLocation(
  ctx: MyContext,
  char: CharacterState
): Promise<CharacterState> {
  if (char.current_region_id && char.current_spot_id) return char;

  const { supabase } = ctx.services;

  // هر spotی که is_default = true باشه
  const { data: spots, error } = await supabase
    .from("spots")
    .select("id, region_id")
    .eq("is_default", true)
    .limit(1);

  if (error) {
    console.error("Supabase default spot error:", error);
    return char;
  }

  if (!spots || spots.length === 0) {
    // هیچ نقطه شروعی تعریف نشده
    return char;
  }

  const spot = spots[0];
  const updated: CharacterState = {
    ...char,
    current_region_id: spot.region_id,
    current_spot_id: spot.id,
    last_move_at: new Date().toISOString(),
  };

  const { error: updErr } = await supabase
    .from("characters")
    .update({
      current_region_id: updated.current_region_id,
      current_spot_id: updated.current_spot_id,
      last_move_at: updated.last_move_at,
    })
    .eq("tg_id", char.tg_id);

  if (updErr) {
    console.error("Supabase update char default location error:", updErr);
    return char;
  }

  return updated;
}

export function registerTravelFeature(bot: Bot<MyContext>) {
  // دستور اصلی مسیر
  bot.command("path", async (ctx) => {
    if (!ctx.from) return;
    let char = await getOrCreateCharacter(ctx);

    // اگر هنوز هیچ مکانی نداره، سعی کن یک نقطه شروع براش ست کنی
    char = await ensureCharacterHasLocation(ctx, char);

    if (!char.current_region_id || !char.current_spot_id) {
      await ctx.reply(
        "هنوز نقطه‌ی شروع برای جهان اکلیس برات تنظیم نشده.\n" +
          "یک spot با is_default = true توی دیتابیس بساز یا از ارباب بخواه برات تنظیم کنه."
      );
      return;
    }

    const { supabase } = ctx.services;

    // لوکیشن فعلی
    const { data: spot, error: spotError } = await supabase
      .from("spots")
      .select("id, title")
      .eq("id", char.current_spot_id)
      .single();

    if (spotError || !spot) {
      console.error("Supabase spot error:", spotError);
      await ctx.reply("نتونستم موقعیت فعلیت رو پیدا کنم. با ارباب صحبت کن.");
      return;
    }

    // همه مسیرهایی که از این spot شروع می‌شن
    const { data: edges, error: edgeError } = await supabase
      .from("edges")
      .select("id, to_spot_id, travel_seconds")
      .eq("from_spot_id", char.current_spot_id);

    if (edgeError) {
      console.error("Supabase edges error:", edgeError);
      await ctx.reply("در حال حاضر مسیرها در دسترس نیستن.");
      return;
    }

    let text = `📍 موقعیت فعلی:\n${spot.title}\n\n`;
    text += "مسیرهای قابل حرکت:\n";

    const kb = new InlineKeyboard();

    if (!edges || edges.length === 0) {
      text += "(هیچ مسیری در این نقطه ثبت نشده است.)";
    } else {
      // برای گرفتن عنوان مقصد، اول همه to_spot_id ها رو جمع می‌کنیم
      const toIds = edges.map((e: any) => e.to_spot_id);
      const { data: destSpots, error: destErr } = await supabase
        .from("spots")
        .select("id, title")
        .in("id", toIds);

      if (destErr) {
        console.error("Supabase dest spots error:", destErr);
        await ctx.reply("در خواندن اطلاعات مقصدها مشکلی پیش آمد.");
        return;
      }

      const mapTitle = new Map<string, string>();
      destSpots?.forEach((s: any) => mapTitle.set(s.id, s.title));

      for (const edge of edges as any[]) {
        const title =
          mapTitle.get(edge.to_spot_id) || "مسیر ناشناس";
        kb.text(`رفتن به ${title}`, `move:${edge.id}`).row();
      }
    }

    await ctx.reply(text, { reply_markup: kb });
  });

  // دکمه حرکت
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    if (!data.startsWith("move:")) {
      await next();
      return;
    }

    const edgeId = Number(data.split(":")[1]);
    if (Number.isNaN(edgeId)) {
      await ctx.answerCallbackQuery();
      return;
    }

    const { supabase } = ctx.services;
    const char = await getOrCreateCharacter(ctx);

    // خود edge
    const { data: edgeRow, error: edgeError } = await supabase
      .from("edges")
      .select("id, travel_seconds, to_spot_id")
      .eq("id", edgeId)
      .single();

    if (edgeError || !edgeRow) {
      console.error("Supabase edge fetch error:", edgeError);
      await ctx.answerCallbackQuery({
        text: "مسیر نامعتبر است.",
        show_alert: true,
      });
      return;
    }

    // spot مقصد
    const { data: destSpot, error: destSpotErr } = await supabase
      .from("spots")
      .select("id, title, region_id")
      .eq("id", edgeRow.to_spot_id)
      .single();

    if (destSpotErr || !destSpot) {
      console.error("Supabase dest spot error:", destSpotErr);
      await ctx.answerCallbackQuery({
        text: "نقطه‌ی مقصد یافت نشد.",
        show_alert: true,
      });
      return;
    }

    const travelSeconds: number = edgeRow.travel_seconds || 0;
    const now = Date.now();
    const readyAt = new Date(now + travelSeconds * 1000).toISOString();

    // ست‌کردن سفر در حال انجام + مقصد
    const { error: updateError } = await supabase
      .from("characters")
      .update({
        travel_ready_at: readyAt,
        pending_region_id: destSpot.region_id,
        pending_spot_id: destSpot.id,
      })
      .eq("tg_id", char.tg_id);

    if (updateError) {
      console.error("update character travel error", updateError);
      await ctx.answerCallbackQuery({
        text: "خطایی در شروع حرکت رخ داد.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.reply(
      travelSeconds > 0
        ? `حرکتت شروع شد.\nزمان تقریبی سفر: ${travelSeconds} ثانیه.\nبعد از پایان، دستور /arrive رو بزن تا دروازه‌ی مقصد برات باز بشه.`
        : "این مسیر تقریبا آنی است. /arrive رو بزن تا مقصدت باز بشه."
    );
  });

  // رسیدن به مقصد
  bot.command("arrive", async (ctx) => {
    if (!ctx.from) return;
    const { supabase } = ctx.services;
    const char = await getOrCreateCharacter(ctx);

    if (!char.travel_ready_at || !char.pending_spot_id || !char.pending_region_id) {
      await ctx.reply(
        "در حال حاضر سفری در حال انجام نداری یا مقصدت مشخص نشده.\n" +
          "اگر فکر می‌کنی باگی پیش اومده، به ارباب گزارش بده."
      );
      return;
    }

    const now = Date.now();
    const readyAtMs = Date.parse(char.travel_ready_at);

    if (now < readyAtMs) {
      const diffSec = Math.ceil((readyAtMs - now) / 1000);
      await ctx.reply(
        `هنوز به مقصد نرسیدی.\nحدود ${diffSec} ثانیه‌ی دیگر باقی مانده است.`
      );
      return;
    }

    // اطلاعات region مقصد
    const { data: destRegion, error: regionErr } = await supabase
      .from("regions")
      .select("id, title, telegram_chat_id")
      .eq("id", char.pending_region_id)
      .single();

    if (regionErr || !destRegion) {
      console.error("Supabase dest region error:", regionErr);
      await ctx.reply(
        "به مقصد رسیدی، اما اطلاعات منطقه‌ی مقصد یافت نشد. با ارباب تماس بگیر."
      );
      return;
    }

    // spot مقصد برای نمایش اسم
    const { data: destSpot, error: spotErr } = await supabase
      .from("spots")
      .select("id, title")
      .eq("id", char.pending_spot_id)
      .single();

    if (spotErr || !destSpot) {
      console.error("Supabase dest spot error (arrive):", spotErr);
      await ctx.reply(
        "به مقصد رسیدی، اما نقطه‌ی دقیق مقصد پیدا نشد. با ارباب تماس بگیر."
      );
      return;
    }

    const oldRegionId = char.current_region_id;

    // آپدیت مکان فعلی به مقصد
    const nowIso = new Date().toISOString();
    const { error: updCharErr } = await supabase
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

    if (updCharErr) {
      console.error("Supabase update character on arrive error:", updCharErr);
      await ctx.reply(
        "به مقصد رسیدی، اما در ثبت نهایی لوکیشن مشکلی پیش آمد. با ارباب تماس بگیر."
      );
      return;
    }

    // 🔜 اینجا جاییه که در نسخه بعد:
    // - اگر oldRegionId != destRegion.id بود:
    //   * از گروه منطقه قبلی کیکش می‌کنیم (ban+unban)
    //   * یک invite link از destRegion.telegram_chat_id می‌گیریم
    //   * با دکمه اینلاین براش می‌فرستیم
    //
    // فعلاً فقط پیام ساده می‌دهیم:

    await ctx.reply(
      `سفرت به پایان رسید.\nالان در منطقه «${destRegion.title}» و لوکیشن «${destSpot.title}» هستی.\n` +
        "در گام بعدی، اینجا لینک دروازه‌ی چت مربوط به این منطقه هم برایت باز خواهد شد."
    );
  });
}
