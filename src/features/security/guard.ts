import { Bot } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

export function registerSecurityFeature(bot: Bot<MyContext>): void {
  // اگر کسی غیر از ارباب ربات را به گروه اضافه کند، خودش را معرفی می‌کند و لفت می‌دهد
  bot.on("my_chat_member", async (ctx) => {
    const status = ctx.myChatMember.new_chat_member.status;
    const chat = ctx.chat;
    const from = ctx.from;

    if (!chat || chat.type === "private") return;

    if (status === "member" || status === "administrator") {
      if (!from || from.id !== MASTER_ID) {
        try {
          await ctx.reply(
            "این ربات متعلق به مجموعه اکلیس است و فقط اربابم حق فعال کردن من را دارد، حدت را بدان."
          );
        } catch (e) {
          console.error("send intro error:", e);
        }
        try {
          await ctx.api.leaveChat(chat.id);
        } catch (e) {
          console.error("leaveChat error:", e);
        }
      }
    }
  });

  // اگر کسی بخواهد به ربات دستور بدهد
  bot.command(["start", "help"], async (ctx, next) => {
    if (!ctx.from) return next();
    if (ctx.chat?.type !== "private" && ctx.from.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم می‌تواند به من دستور بدهد، حدت را بدان.");
      return;
    }
    return next();
  });
}