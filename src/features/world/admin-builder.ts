import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

export function registerWorldAdminFeature(bot: Bot<MyContext>) {
  bot.command("worldadmin", async (ctx) => {
    if (ctx.from?.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم میتونه بهم دستور بده، حدتو بدون");
      return;
    }

    const kb = new InlineKeyboard()
      .text("➕ ساخت منطقه جدید", "admin:new_region").row()
      .text("➕ ساخت لوکیشن جدید", "admin:new_spot").row()
      .text("🔗 اتصال مسیرها", "admin:new_edge");

    await ctx.reply("پنل مدیریت جهان اکلیس:", { reply_markup: kb });
  });

  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    if (!data.startsWith("admin:")) {
      await next();
      return;
    }

    if (ctx.from?.id !== MASTER_ID) {
      await ctx.answerCallbackQuery({
        text: "فقط اربابم میتونه بهم دستور بده، حدتو بدون",
        show_alert: true,
      });
      return;
    }

    if (data === "admin:new_region") {
      await ctx.answerCallbackQuery();
      await ctx.reply(
        "برای ساخت منطقه جدید، فعلاً در Supabase رکورد بساز.\n" +
          "در نسخه‌های بعدی، این بخش کاملاً اینلاین و تعاملی میشه."
      );
      return;
    }

    if (data === "admin:new_spot") {
      await ctx.answerCallbackQuery();
      await ctx.reply("ساخت لوکیشن جدید به‌زودی از طریق ربات فعال می‌شود.");
      return;
    }

    if (data === "admin:new_edge") {
      await ctx.answerCallbackQuery();
      await ctx.reply("ساخت مسیر (edge) جدید به‌زودی از طریق ربات فعال می‌شود.");
      return;
    }

    await next();
  });
}