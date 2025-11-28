
import { Bot } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

export function registerSecurityFeature(bot: Bot<MyContext>) {
  // اگر کسی غیر از ارباب بخواهد دستور حساس بزند
  bot.on("message:text", async (ctx, next) => {
    if (!ctx.from) return;
    const isMaster = ctx.from.id === MASTER_ID;

    const text = ctx.message.text.trim();
    const sensitiveCommands = ["/worldadmin", "/regplayer"];

    if (sensitiveCommands.some((c) => text.startsWith(c)) && !isMaster) {
      await ctx.reply("فقط اربابم می‌تونه بهم دستور بده، حدتو بدون.");
      return;
    }

    await next();
  });

  // اگر کسی ربات را جایی جوین کرد که نباید بماند (در آینده میشه شرط گذاشت)
  bot.on("my_chat_member", async (ctx) => {
    const status = ctx.myChatMember.new_chat_member.status;
    if (status === "member" || status === "administrator") {
      // فعلاً اجازه می‌دهیم، بعداً می‌توانیم محدود کنیم
      return;
    }
  });
}
