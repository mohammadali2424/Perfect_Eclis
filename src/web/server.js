const express = require('express');
const axios = require('axios');

async function probeWebhook(bot) {
  try {
    const info = await bot.telegram.getWebhookInfo();
    return info;
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

async function startServer(bot, cfg) {
  const app = express();
  app.use(express.json());

  // Health
  app.get('/ping', (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));

  // Debug: ببین وضعیت وبهوک از نظر تلگرام چیه
  app.get('/debug/webhook-info', async (_req, res) => {
    const info = await probeWebhook(bot);
    res.status(200).json(info);
  });

  // Root
  app.get('/', (_req, res) => res.send('<h3>RPG World Bot</h3><p>/debug/webhook-info را ببین.</p>'));

  // Telegraf webhook handler
  app.use(bot.webhookCallback('/webhook'));

  const server = app.listen(cfg.port, async () => {
    console.log('🚀 HTTP up on', cfg.port);

    // اگر FORCE_POLLING=1 ست باشد → فقط polling
    const forcePolling = String(process.env.FORCE_POLLING || '').trim() === '1';

    // همیشه ابتدا وبهوک را پاک کن
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    } catch (e) {
      console.log('Webhook delete warn:', e.message);
    }

    if (!forcePolling && cfg.renderUrl) {
      const url = `${cfg.renderUrl.replace(/\/+$/,'')}/webhook`;
      try {
        await bot.telegram.setWebhook(url, {
          allowed_updates: ['message', 'callback_query', 'chat_join_request', 'my_chat_member', 'chat_member']
        });
        console.log('✅ Webhook set:', url);

        // heartbeat برای بیدارنگه‌داشتن Render
        setInterval(() => { axios.head(`${cfg.renderUrl}/ping`).catch(() => {}); }, 14 * 60 * 1000);
      } catch (e) {
        console.log('Webhook set failed:', e.message, '→ fallback to polling');
        await bot.launch({
          allowedUpdates: ['message', 'callback_query', 'chat_join_request', 'my_chat_member', 'chat_member']
        });
        console.log('✅ Long polling (fallback)');
      }
    } else {
      await bot.launch({
        allowedUpdates: ['message', 'callback_query', 'chat_join_request', 'my_chat_member', 'chat_member']
      });
      console.log('✅ Long polling (FORCE_POLLING or no renderUrl)');
    }
  });

  return server;
}

module.exports = { startServer };
