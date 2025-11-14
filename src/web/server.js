// src/web/server.js
const express = require('express');
const axios = require('axios');

function startServer(bot, config = {}) {
  const app = express();
  app.use(express.json());

  // Health
  app.get('/ping', (_req, res) => res.status(200).json({ ok: true }));

  const PORT = Number(config.port || process.env.PORT || 3000);
  const PUBLIC_URL_RAW = config.publicUrl || process.env.RENDER_EXTERNAL_URL || '';
  const PUBLIC_URL = PUBLIC_URL_RAW.replace(/\/+$/, '');

  if (!PUBLIC_URL) {
    console.error('❌ برای webhook-only باید RENDER_EXTERNAL_URL تنظیم شود.');
    process.exit(1);
  }

  // فقط POST وبهوک + لاگ نوع آپدیت
  app.post(
    '/webhook',
    (req, _res, next) => {
      try {
        const u = req.body || {};
        const type = u.message ? 'message'
          : u.callback_query ? 'callback_query'
          : u.chat_join_request ? 'chat_join_request'
          : u.my_chat_member ? 'my_chat_member'
          : Object.keys(u)[0] || 'unknown';
        console.log('↘️ /webhook', new Date().toISOString(), 'type:', type);
      } catch {}
      return next();
    },
    bot.webhookCallback('/webhook')
  );

  app.get('/', (_req, res) => res.status(200).send('<h3>RPG Bot — OK</h3>'));

  app.listen(PORT, async () => {
    console.log('🚀 HTTP on', PORT);
    try {
      // پاک‌سازی قبلی و ست‌کردن وبهوک جدید
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      const url = `${PUBLIC_URL}/webhook`;
      await bot.telegram.setWebhook(url, {
        allowed_updates: ['message','callback_query','chat_join_request','my_chat_member','chat_member']
      });
      console.log('✅ Webhook set to:', url);

      // لاگ وضعیت وبهوک
      const info = await bot.telegram.getWebhookInfo();
      console.log('ℹ️ Webhook info:', {
        url: info.url,
        has_custom_certificate: info.has_custom_certificate,
        pending_update_count: info.pending_update_count
      });
    } catch (e) {
      console.error('Webhook error:', e?.message || e);
      process.exit(1);
    }

    // self-ping برای Render (هر ~14 دقیقه)
    const pingUrl = `${PUBLIC_URL}/ping`;
    setInterval(() => { axios.head(pingUrl).catch(() => {}); }, 14 * 60 * 1000);
  });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { startServer };
