
import { Bot } from "grammy";
import { MyContext } from "../core/types";
import { MASTER_ID } from "../core/config";

export function registerRegistrationFeature(bot: Bot<MyContext>) {
  // ثبت بازیکن با ریپلای /regplayer
  bot.command("regplayer", async (ctx) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) return;

    if (!ctx.message?.reply_to_message) {
      await ctx.reply("باید روی پیام بازیکن ریپلای کرده و سپس /regplayer بفرستی.");
      return;
    }

    const replyUser = ctx.message.reply_to_message.from;
    if (!replyUser) {
      await ctx.reply("کاربر هدف پیدا نشد.");
      return;
    }

    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) {
      await ctx.reply("این دستور باید داخل گروهی که Region آن ثبت شده اجرا شود.");
      return;
    }

    const { supabase } = ctx.services;

    const { data: region, error: regErr } = await supabase
      .from("regions")
      .select("*")
      .eq("telegram_chat_id", chat.id)
      .maybeSingle();

    if (regErr || !region) {
      await ctx.reply(
        "Region مربوط به این گروه در دیتابیس پیدا نشد.\nاول /worldadmin را بزن تا Region ساخته شود."
      );
      return;
    }

    const { data: anySpot } = await supabase
      .from("spots")
      .select("*")
      .eq("region_id", region.id)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    const startSpotId = anySpot ? (anySpot as any).id : null;

    const { data: exists } = await supabase
      .from("characters")
      .select("id")
      .eq("tg_id", replyUser.id)
      .maybeSingle();

    if (exists) {
      await ctx.reply("این بازیکن قبلاً ثبت شده است.");
      return;
    }

    const charName = replyUser.first_name;

    const { error: insErr } = await supabase.from("characters").insert({
      tg_id: replyUser.id,
      char_name: charName,
      current_region_id: region.id,
      current_spot_id: startSpotId,
      last_move_at: null,
      travel_ready_at: null,
    });

    if (insErr) {
      console.error("insert character error:", insErr);
      await ctx.reply("در ثبت بازیکن خطایی رخ داد.");
      return;
    }

    await ctx.reply(
      `شخصیت <b>${charName}</b> در جهان اکلیس ثبت شد.\nRegion: <code>${region.title}</code>`,
      { parse_mode: "HTML" }
    );
  });
}
