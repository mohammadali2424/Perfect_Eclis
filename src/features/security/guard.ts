import { Bot } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

export function registerSecurityFeature(bot: Bot<MyContext>): void {
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    const chat = update.chat;
    const newStatus = update.new_chat_member.status;
    const from = update.from;

    if (!chat || chat.type === "private") return;

    if (newStatus === "member" || newStatus === "administrator") {
      if (!from || from.id !== MASTER_ID) {
        try {
          await ctx.api.sendMessage(
            chat.id,
            "این ربات متعلق به مجموعه اکلیس است و فقط اربابم حق فعال کردن من را دارد، حدت را بدان."
          );
        } catch (e) {
          console.error("sendMessage before leaveChat failed:", e);
        }

        try {
          await ctx.api.leaveChat(chat.id);
        } catch (e) {
          console.error("leaveChat failed:", e);
        }
      }
    }
  });

  bot.command(["start", "help"], async (ctx, next) => {
    if (!ctx.from) return next();

    if (ctx.chat?.type !== "private" && ctx.from.id !== MASTER_ID) {
      await ctx.reply(
        "🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون"
      );
      return;
    }

    return next();
  });
}
