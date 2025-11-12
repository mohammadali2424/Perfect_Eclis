// src/app.js
// نقطه‌ی اجرای اصلی: config را می‌سازد، buildBot را صدا می‌زند، launch می‌کند، و Graceful Stop هندل می‌کند.

const { buildBot } = require('./bot');

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN در env تعریف نشده است.');
}
const OWNER_ID = Number(process.env.OWNER_ID || process.env.BOT_OWNER_ID || 0);
if (!OWNER_ID) {
  console.warn('⚠️ OWNER_ID تنظیم نشده؛ دستورات ادمینی فقط برای owner کار می‌کنند.');
}
const NODE_ENV = process.env.NODE_ENV || 'production';

const config = {
  token: BOT_TOKEN,
  ownerId: OWNER_ID,
  env: NODE_ENV,
};

(async () => {
  try {
    const bot = await buildBot(config);

    // به‌جای چند نمونه موازی، آپدیت‌های قدیمی را Drop کن تا 409 نگیری
    await bot.launch({ dropPendingUpdates: true });

    const me = await bot.telegram.getMe();
    console.log(`🤖 Bot launched as @${me.username} (env: ${NODE_ENV})`);

    process.once('SIGINT', () => {
      console.log('SIGINT received, stopping bot...');
      bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      console.log('SIGTERM received, stopping bot...');
      bot.stop('SIGTERM');
    });
  } catch (e) {
    console.error('Failed to launch bot:', e);
    process.exit(1);
  }
})();
