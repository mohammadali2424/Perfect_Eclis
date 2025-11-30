import { Bot } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

export function registerWorldAdminFeature(bot: Bot<MyContext>): void {
  bot.command("worldadmin", async (ctx) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم به پنل جهان‌ساز دسترسی دارد.");
      return;
    }

    // این دستور باید داخل یک گروه Region اجرا شود
    const chat = ctx.chat;
    if (!chat || chat.type === "private") {
      await ctx.reply("برای ثبت Region باید این دستور را داخل یک گروه بفرستی.");
      return;
    }

    const { supabase } = ctx.services;
    const chatId = chat.id;
    const title = chat.title || "Region بدون نام";

    // ببین این گروه قبلاً به عنوان Region ثبت شده یا نه
    const { data: existing, error: exErr } = await supabase
      .from("regions")
      .select("*")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();

    if (exErr) {
      console.error("regions select error:", exErr);
      await ctx.reply("در بررسی Region مشکلی پیش آمد.");
      return;
    }

    if (existing) {
      await ctx.reply(
        "این گروه از قبل به عنوان یک Region ثبت شده است ✅\n" +
          `نام: ${existing.title}\n` +
          `chat_id: ${existing.telegram_chat_id}\n\n` +
          "حالا می‌توانی در Supabase جدول spots را باز کنی و برای این Region Spot بسازی.\n" +
          "بعد از ساخت حداقل یک Spot، از /regplayer برای قرار دادن پلیرها در این Region استفاده کن."
      );
      return;
    }

    // اگر Region وجود نداشت، یکی جدید بساز
    const { error: insErr } = await supabase.from("regions").insert({
      title,
      telegram_chat_id: chatId,
    });

    if (insErr) {
      console.error("regions insert error:", insErr);
      await ctx.reply("در ثبت Region جدید خطایی رخ داد.");
      return;
    }

    await ctx.reply(
      "Region جدید ثبت شد ✅\n" +
        `نام: ${title}\n` +
        `chat_id: ${chatId}\n\n` +
        "حالا در Supabase جدول spots را باز کن و حداقل یک Spot برای این Region بساز.\n" +
        "سپس از /regplayer برای ثبت پلیرها استفاده کن."
    );
  });
}
