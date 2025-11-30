import { Bot } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

export function registerSecurityFeature(bot: Bot<MyContext>): void {
  // هر وقت وضعیت عضویت ربات در یک چت عوض می‌شود (اضافه شدن / حذف شدن)
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    const chat = update.chat;
    const newStatus = update.new_chat_member.status;
    const from = update.from;

    // فقط برای گروه‌ها مهم است
    if (!chat || chat.type === "private") return;

    // وقتی ربات به عنوان member/admin وارد گروه شد
    if (newStatus === "member" || newStatus === "administrator") {
      // اگر کسی که ربات را اضافه کرده ارباب نیست، لفت بده
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

  // محافظ /start و /help در گروه‌ها
  bot.command(["start", "help"], async (ctx, next) => {
    if (!ctx.from) return next();

    // اگر در گروه/سوپرگروه هستیم و فرستنده ارباب نیست، رد کن
    if (ctx.chat?.type !== "private" && ctx.from.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم می‌تواند به من دستور بدهد، حدت را بدان.");
      return;
    }

    return next();
  });
}
