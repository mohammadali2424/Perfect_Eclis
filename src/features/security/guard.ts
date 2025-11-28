import type { EclisContext } from "../../core/bot.js";
import { BOT_OWNER_ID } from "../../core/config.js";

// هرکس غیر از ارباب، ربات را به گروهی اد کند:
export async function handleNewChatMembers(ctx: EclisContext) {
  const me = await ctx.api.getMe();
  const newMembers = ctx.message?.new_chat_members ?? [];
  const botJoined = newMembers.some((m) => m.id === me.id);
  if (!botJoined) return;

  const fromId = ctx.from?.id;
  if (!fromId || fromId !== BOT_OWNER_ID) {
    await ctx.reply(
      "این ربات متعلق به مجموعه اکلیس است و فقط اربابم حق فعال کردن منو داره، حدّتو بدون."
    );
    // لفت
    await ctx.api.leaveChat(ctx.chat!.id);
  }
}
