const express = require('express');
const axios = require('axios');

async function startServer(bot, cfg){
  const app = express();
  app.use(express.json());

  app.get('/ping', (_req,res) => res.status(200).json({ ok: true }));
  app.use(bot.webhookCallback('/webhook'));
  app.get('/', (_req,res) => res.send('<h3>RPG World Bot</h3>'));

  const server = app.listen(cfg.port, async () => {
    console.log('🚀 Bot on', cfg.port);
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    } catch(e) { console.log('Webhook delete warn:', e.message); }

    if (cfg.renderUrl) {
      const url = `${cfg.renderUrl}/webhook`;
      try {
        await bot.telegram.setWebhook(url, {
          allowed_updates: ['message', 'callback_query', 'chat_join_request', 'my_chat_member', 'chat_member']
        });
        console.log('✅ Webhook:', url);
      } catch(e) { console.log('Webhook set warn:', e.message); }

      setInterval(() => {
        axios.head(`${cfg.renderUrl}/ping`).catch(() => {});
      }, 14 * 60 * 1000);
    } else {
      try {
        await bot.launch({
          allowedUpdates: ['message','callback_query','chat_join_request','my_chat_member','chat_member']
        });
        console.log('✅ Long polling');
      } catch(e) { console.log('Launch warn:', e.message); }
    }
  });

  return server;
}

module.exports = { startServer };
