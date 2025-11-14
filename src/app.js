const http = require('http');
const { URL } = require('url');
const { buildBot } = require('./bot');

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN در env تعریف نشده است.');

const OWNER_ID = Number(process.env.OWNER_ID || process.env.BOT_OWNER_ID || 0);
if (!OWNER_ID) {
  console.warn('⚠️ OWNER_ID تنظیم نشده؛ دستورات ادمینی فقط برای ارباب کار می‌کنند.');
}

const NODE_ENV = process.env.NODE_ENV || 'production';

// این آدرس باید آدرس سرویس Renderت باشه + یه مسیر مخفی
// مثلا: https://my-rpg-bot.onrender.com/telegram/secret123
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!WEBHOOK_URL) {
  throw new Error(
    'WEBHOOK_URL در env تنظیم نشده. مثلا: https://<service>.onrender.com/telegram/<secret>',
  );
}

const PORT = Number(process.env.PORT || 3000);

const config = {
  token: BOT_TOKEN,
  ownerId: OWNER_ID,
  env: NODE_ENV,
};

(async () => {
  try {
    const bot = await buildBot(config);

    // مسیر webhook را از روی URL در می‌آوریم (فقط path)
    const urlObj = new URL(WEBHOOK_URL);
    const hookPath = urlObj.pathname || '/';

    console.log('🌐 Webhook URL:', WEBHOOK_URL);
    console.log('📍 Webhook path:', hookPath);
    console.log('📡 Listening on port:', PORT);

    // هر webhook قدیمی را با URL جدید اووررایت کن
    await bot.telegram.setWebhook(WEBHOOK_URL, {
      drop_pending_updates: true,
      allowed_updates: ['message', 'edited_message', 'callback_query'],
    });

    // هندلر خود Telegraf برای webhook
    const callback = bot.webhookCallback(hookPath);

    // سرور HTTP برای Render (باید روی PORT گوش بدهد)
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === hookPath) {
        // اینجا updateهای تلگرام می‌آیند
        return callback(req, res);
      }

      // برای health check و بقیه‌ی requestها
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('OK');
    });

    server.listen(PORT, () => {
      console.log(
        `🚀 Bot is running with webhook on ${WEBHOOK_URL} (env: ${NODE_ENV})`,
      );
    });

    // خاموش کردن تمیز
    process.once('SIGINT', () => {
      console.log('SIGINT received, closing server...');
      server.close(() => process.exit(0));
    });
    process.once('SIGTERM', () => {
      console.log('SIGTERM received, closing server...');
      server.close(() => process.exit(0));
    });
  } catch (e) {
    console.error('Failed to launch bot (webhook mode):', e);
    process.exit(1);
  }
})();
