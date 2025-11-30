import { Bot } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

// این نسخهٔ ساده فقط اسکلت /worldadmin را می‌سازد
// و توضیح می‌دهد که باید Regions / Spots / Edges را چگونه در Supabase پر کنید.
// می‌توانی بعداً آن را با دکمه‌های اینلاین و منوی کامل جایگزین کنی.

export function registerWorldAdminFeature(bot: Bot<MyContext>): void {
  bot.command("worldadmin", async (ctx) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم به پنل جهان‌ساز دسترسی دارد.");
      return;
    }

    if (!ctx.chat || ctx.chat.type === "private") {
      await ctx.reply(
        "این دستور را باید داخل گروهی بفرستی که می‌خواهی به عنوان Region ثبت شود."
      );
      return;
    }

    const chat = ctx.chat;
    const chatId = chat.id;
    const title = chat.title || "Unnamed Region";

    const { supabase } = ctx.services;

    const { data: existing, error: selErr } = await supabase
      .from("regions")
      .select("id")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();

    if (selErr) {
      console.error("regions select error:", selErr);
    }

    if (existing) {
      await ctx.reply(
        "این گروه از قبل به عنوان یک Region ثبت شده است.\n" +
          "می‌توانی Spots و Edges را مستقیماً در Supabase اضافه کنی."
      );
      return;
    }

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
        "حالا در Supabase جدول spots را باز کن و حداقل یک Spot برای این Region بساز،\n" +
        "سپس از /regplayer برای ثبت پلیرها استفاده کن."
    );
  });
}