// src/web/server.js
const express = require('express');
const axios = require('axios');

/**
 * startServer(bot, config)
 *  - config: { port, publicUrl (RENDER_EXTERNAL_URL), dropPendingUpdates=true }
 */
function startServer(bot, config = {}) {
  const app = express();
  app.use(express.json());

  // health & keepalive
  app.get('/ping', (_req, res) => res.status(200).json({ ok: true }));

  // وبهوک تلگرام
  app.use(bot.webhookCallback('/webhook'));

  // صفحه‌ی ساده‌ی روت
  app.get('/', (_req, res) => res.send('<h3>RPG Telegram Bot — OK</h3>'));

  const PORT = Number(config.port || process.env.PORT || 3000);
  const PUBLIC_URL = config.publicUrl || process.env.RENDER_EXTERNAL_URL || '';

  function startKeepAlive() {
    if (!PUBLIC_URL) return;
    const url = `${PUBLIC_URL.replace(/\/+$/,'')}/ping`;
    // هر 13:59 دقیقه یکبار
    setInterval(() => {
      axios.head(url).catch(() => {});
    }, 13 * 60 * 1000 + 59 * 1000);
  }

  app.listen(PORT, async () => {
    console.log('🚀 HTTP on', PORT);

    // self-ping برای Render
    startKeepAlive();

    try {
      // وبهوک یا لانگ‌پول
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      if (PUBLIC_URL) {
        const url = `${PUBLIC_URL.replace(/\/+$/,'')}/webhook`;
        await bot.telegram.setWebhook(url);
        console.log('✅ Webhook:', url);
      } else {
        await bot.launch({ allowedUpdates: ['message','callback_query','chat_join_request','my_chat_member','chat_member'] });
        console.log('✅ Long polling');
      }
    } catch (e) {
      console.log('Startup warn:', e?.message || e);
    }
  });

  // امنیت: خاموش کردن نرمی
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { startServer };
