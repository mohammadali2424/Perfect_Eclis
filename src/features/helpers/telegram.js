// src/features/helpers/telegram.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function canDMUser(bot, userId) {
  try {
    // سبک‌ترین تست بدون تولید پیام
    await bot.telegram.sendChatAction(userId, 'typing');
    return true;
  } catch (e) {
    const m = String(e.message || e);
    if (
      /bot was blocked by the user|chat not found|user is deactivated|initiate conversation|have no rights/i.test(
        m
      )
    ) {
      return false;
    }
    // خطاهای عجیب را هم به‌عنوان «نمی‌توان DM داد» حساب نکنیم
    return false;
  }
}

async function safeDelete(ctx, chatId, messageId) {
  try {
    await ctx.telegram.deleteMessage(chatId, messageId);
  } catch (_) {}
}

async function ephemeralNotice(ctx, chatId, text, ms = 4000) {
  try {
    const m = await ctx.telegram.sendMessage(chatId, text, {
      disable_notification: true,
      disable_web_page_preview: true,
    });
    setTimeout(() => {
      ctx.telegram.deleteMessage(chatId, m.message_id).catch(() => {});
    }, ms);
  } catch (_) {}
}

module.exports = { canDMUser, safeDelete, ephemeralNotice, sleep };
