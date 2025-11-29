import { Bot } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

const NOT_MASTER_TEXT = "فقط اربابم میتونه بهم دستور بده، حدتو بدون";
const WRONG_GROUP_TEXT =
  "این ربات متعلق به مجموعه اکلیس است و فقط اربابم حق فعال کردن منو داره، حدتو بدون";

export function registerSecurityFeature(bot: Bot<MyContext>) {
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    const userId = ctx.from?.id;

    if (data.startsWith("admin:")) {
      if (userId !== MASTER_ID) {
        await ctx.answerCallbackQuery({ text: NOT_MASTER_TEXT, show_alert: true });
        return;
      }
    }

    await next();
  });

  bot.on("my_chat_member", async (ctx) => {
    const status = ctx.myChatMember.new_chat_member.status;
    const chat = ctx.chat;
    const userId = ctx.from?.id;

    if (status === "member" || status === "administrator") {
      if (userId !== MASTER_ID) {
        if (chat?.id) {
          try {
            await ctx.api.sendMessage(chat.id, WRONG_GROUP_TEXT);
          } catch {}
          try {
            await ctx.api.leaveChat(chat.id);
          } catch {}
        }
      }
    }
  });
}