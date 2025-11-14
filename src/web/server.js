// src/web/server.js
const express = require('express');
const axios = require('axios');

function startServer(bot, config = {}) {
  const app = express();
  app.use(express.json());

  // Health
  app.get('/ping', (_req, res) => res.status(200).json({ ok: true }));

  // فقط وبهوک
  app.use('/webhook', bot.webhookCallback('/webhook'));

  const PORT = Number(config.port || process.env.PORT || 3000);
  const PUBLIC_URL_RAW = config.publicUrl || process.env.RENDER_EXTERNAL_URL || '';
  const PUBLIC_URL = PUBLIC_URL_RAW.replace(/\/+$/, '');

  if (!PUBLIC_URL) {
    console.error('❌ برای حالت webhook-only باید RENDER_EXTERNAL_URL تنظیم شود.');
    process.exit(1);
  }

  app.listen(PORT, async () => {
    console.log('🚀 HTTP on', PORT);
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      const url = `${PUBLIC_URL}/webhook`;
      await bot.telegram.setWebhook(url);
      console.log('✅ Webhook:', url);
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
