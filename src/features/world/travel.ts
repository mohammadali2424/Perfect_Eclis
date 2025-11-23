import { Bot, InlineKeyboard } from "grammy";
import { MyContext, CharacterState } from "../../core/types";

// Helpers to read/write character state in Supabase
async function getOrCreateCharacter(ctx: MyContext): Promise<CharacterState> {
  const { supabase } = ctx.services;
  const tgId = ctx.from!.id;

  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", tgId)
    .single();

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

export function registerTravelFeature(bot: Bot<MyContext>) {
  // Command for players to see their current location and possible exits
  bot.command("path", async (ctx) => {
    if (!ctx.from) return;
    const char = await getOrCreateCharacter(ctx);

    if (!char.current_region_id || !char.current_spot_id) {
      await ctx.reply(
        "هنوز در هیچ جای جهان اکلیس قرار نگرفتی.\n" +
          "به زودی با کمک اربابم نقطه‌ی شروعت تنظیم میشه."
      );
      return;
    }

    const { supabase } = ctx.services;

    const { data: spot, error: spotError } = await supabase
      .from("spots")
      .select("*")
      .eq("id", char.current_spot_id)
      .single();

    if (spotError || !spot) {
      await ctx.reply("نتونستم موقعیت فعلیت رو پیدا کنم. با اربابم صحبت کن.");
      return;
    }

    const { data: edges, error: edgeError } = await supabase
      .from("edges")
      .select("id, to_spot_id, travel_seconds, spots!edges_to_spot_id_fkey(title)")
      .eq("from_spot_id", char.current_spot_id);

    if (edgeError) {
      console.error("Supabase edges error", edgeError);
      await ctx.reply("در حال حاضر مسیرها در دسترس نیستن.");
      return;
    }

    let text = `📍 موقعیت فعلی:\n${spot.title}\n\n`;
    text += "مسیرهای قابل حرکت:";

    const kb = new InlineKeyboard();

    if (!edges || edges.length === 0) {
      text += "\n(هیچ مسیری در این نقطه ثبت نشده است.)";
    } else {
      for (const edge of edges as any[]) {
        const title = edge.spots?.title || "مسیر بعدی";
        kb
          .text(`رفتن به ${title}`, `move:${edge.id}`)
          .row();
      }
    }

    await ctx.reply(text, { reply_markup: kb });
  });

  // Handle travel button (start movement & timer)
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

    // Fetch edge details, include to_spot and region for link
    const { data: edgeRow, error: edgeError } = await supabase
      .from("edges")
      .select(
        "id, travel_seconds, to_spot_id, spots!edges_to_spot_id_fkey(id, title, region_id), regions!spots_region_id_fkey(id, title, telegram_chat_id)"
      )
      .eq("id", edgeId)
      .single();

    if (edgeError || !edgeRow) {
      console.error("edge fetch error", edgeError);
      await ctx.answerCallbackQuery({ text: "مسیر نامعتبر است.", show_alert: true });
      return;
    }

    const travelSeconds: number = edgeRow.travel_seconds || 0;
    const now = Date.now();
    const readyAt = new Date(now + travelSeconds * 1000).toISOString();

    // Update character: movement in progress, region/spot will be updated when finished
    const { error: updateError } = await supabase
      .from("characters")
      .update({
        travel_ready_at: readyAt,
        // we don't change current_spot yet; it's changed client-side logically
      })
      .eq("tg_id", char.tg_id);

    if (updateError) {
      console.error("update character travel error", updateError);
      await ctx.answerCallbackQuery({ text: "خطایی در شروع حرکت رخ داد.", show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.reply(
      travelSeconds > 0
        ? `حرکتت شروع شد.\nزمان تقریبی سفر: ${travelSeconds} ثانیه.\nبعد از پایان، دوباره /path رو بزن تا دروازه‌ی مقصد برات باز بشه.`
        : "این مسیر تقریبا آنی است. /path رو بزن تا مقصدت باز بشه."
    );
  });

  // Simple helper: when user runs /arrive, we check timer & give them the invite link + kick from previous region if needed
  bot.command("arrive", async (ctx) => {
    if (!ctx.from) return;
    const { supabase } = ctx.services;
    const char = await getOrCreateCharacter(ctx);

    if (!char.travel_ready_at) {
      await ctx.reply("در حال حاضر در حال سفری نیستی که به مقصد رسیده باشی.");
      return;
    }

    const now = Date.now();
    const readyAtMs = Date.parse(char.travel_ready_at);

    if (now < readyAtMs) {
      const diffSec = Math.ceil((readyAtMs - now) / 1000);
      await ctx.reply(`هنوز به مقصد نرسیدی. حدود ${diffSec} ثانیه دیگر باقی مانده است.`);
      return;
    }

    // در این نسخه اسکلت، ما فقط پیام می‌دهیم که سفر کامل شده.
    // در نسخه‌ی بعدی اینجا:
    // - current_region_id / current_spot_id را آپدیت می‌کنیم
    // - لینک گروه مقصد را می‌گیریم و با دکمه اینلاین می‌فرستیم
    // - در صورت نیاز، از گروه مبدأ کیک می‌کنیم (با ban+unban)

    await ctx.reply(
      "سفرت به پایان رسیده است.\nدر نسخه‌ی بعدی، اینجا لینک دروازه‌ی مقصد برایت باز می‌شود."
    );

    const { error: clearError } = await supabase
      .from("characters")
      .update({ travel_ready_at: null })
      .eq("tg_id", char.tg_id);

    if (clearError) {
      console.error("clear travel_ready_at error", clearError);
    }
  });
}