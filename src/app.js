const { buildBot } = require('./bot');

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN در env تعریف نشده است.');

const OWNER_ID = Number(process.env.OWNER_ID || process.env.BOT_OWNER_ID || 0);
if (!OWNER_ID) {
  console.warn('⚠️ OWNER_ID تنظیم نشده؛ دستورات ادمینی فقط برای ارباب کار می‌کنند.');
}

const NODE_ENV = process.env.NODE_ENV || 'production';

// پینگ هر چند دقیقه یک‌بار (پیش‌فرض ۱۴ دقیقه)
const PING_INTERVAL_MIN = Number(process.env.PING_INTERVAL_MIN || 14);

const config = {
  token: BOT_TOKEN,
  ownerId: OWNER_ID,
  env: NODE_ENV,
};

(async () => {
  try {
    const bot = await buildBot(config);

    await bot.launch({ dropPendingUpdates: true });

    const me = await bot.telegram.getMe();
    console.log(`🤖 Bot launched as @${me.username} (env: ${NODE_ENV})`);

    // 🔔 پینگ خودکار برای زنده نگه داشتن سرویس (Render)
    const pingMs = PING_INTERVAL_MIN * 60 * 1000;
    console.log(`⏱  Auto-ping every ${PING_INTERVAL_MIN} minutes فعال شد.`);
    setInterval(() => {
      bot.telegram
        .getMe()
        .then(() => {
          console.log('✅ Ping OK');
        })
        .catch((err) => {
          console.error('⚠️ Ping error:', err.message);
        });
    }, pingMs);

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
