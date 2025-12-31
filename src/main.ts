// src/main.ts
import express from 'express';

import { env } from './config/env.js';
import { createLogger } from './core/utils/logger.js';
import { createBot } from './core/bot/createBot.js';
import { CommandRegistry } from './core/commands/registry.js';

import { createMemoryUnitOfWork } from './adapters/storage/memory.js';

import { registerSystemCommands } from './modules/system/index.js';
import { registerXpCommands } from './modules/xp/index.js';

async function main() {
  const logger = createLogger(env.NODE_ENV === 'production' ? 'info' : 'debug');

  // --- Storage (فعلاً Memory؛ بعداً Supabase/Postgres را همینجا سوییچ می‌کنیم) ---
  const uow = createMemoryUnitOfWork();

  // --- Commands registry ---
  const registry = new CommandRegistry();
  registerSystemCommands(registry);
  registerXpCommands(registry);

  // --- Bot ---
  const bot = createBot({
    token: env.BOT_TOKEN,
    registry,
    uow,
    logger,
  });

  // --- HTTP (Webhook) ---
  const app = express();

  // Health check
  app.get('/', (_req, res) => res.status(200).send('OK'));

  // Telegram will POST updates here
  app.post(
    env.WEBHOOK_PATH,
    bot.webhookCallback(env.WEBHOOK_PATH, { secretToken: env.WEBHOOK_SECRET })
  );

  app.listen(env.PORT, () => {
    logger.info('HTTP server listening', { port: env.PORT, webhookPath: env.WEBHOOK_PATH });
  });

  // --- Set webhook (only if BASE_URL provided) ---
  if (!env.BASE_URL) {
    logger.warn('BASE_URL is empty; webhook not set automatically');
  } else {
    const url = `${env.BASE_URL}${env.WEBHOOK_PATH}`;
    try {
      await bot.telegram.setWebhook(url, { secret_token: env.WEBHOOK_SECRET });
      logger.info('Webhook set', { url });
    } catch (err) {
      logger.error('Failed to set webhook', { err: String(err), url });
    }
  }
}

main().catch((err) => {
  // اگر اینجا کرش کند، Render لاگ می‌گیرد
  // (مهم: پیام اول باید string باشد)
  // eslint-disable-next-line no-console
  console.error(err);
});
