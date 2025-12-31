import express from 'express';
import { env } from './config/env.js';
import { createLogger } from './core/utils/logger.js';
import { CommandRegistry } from './core/commands/registry.js';
import { createBot } from './core/bot/createBot.js';
import { MemoryUnitOfWork } from './adapters/storage/memory.js';
import { registerHelpModule } from './modules/help/index.js';
import { registerXpModule } from './modules/xp/index.js';
import { registerAdminModule } from './modules/admin/index.js';

const logger = createLogger(env.NODE_ENV === 'development' ? 'debug' : 'info');

if (!env.BOT_TOKEN) {
  throw new Error('BOT_TOKEN is required');
}

const registry = new CommandRegistry();
registerHelpModule(registry);
registerXpModule(registry);
registerAdminModule(registry);

const uow = new MemoryUnitOfWork();

const bot = createBot({ token: env.BOT_TOKEN, registry, uow, logger });

const app = express();
app.get('/health', (_req, res) => res.status(200).send('ok'));

// Telegram sends JSON
app.use(express.json());

const webhookPath = env.WEBHOOK_PATH.startsWith('/') ? env.WEBHOOK_PATH : `/${env.WEBHOOK_PATH}`;
app.use(webhookPath, bot.webhookCallback(webhookPath));

app.listen(env.PORT, async () => {
  logger.info(`HTTP server listening`, { port: env.PORT, webhookPath });

  if (env.BASE_URL) {
    const url = `${env.BASE_URL}${webhookPath}`;
    try {
      await bot.telegram.setWebhook(url, env.WEBHOOK_SECRET ? { secret_token: env.WEBHOOK_SECRET } : undefined);
      logger.info('Webhook set', { url });
    } catch (err) {
      logger.error('Failed to set webhook', { err });
    }
  } else {
    logger.warn('BASE_URL is empty; webhook not set automatically');
  }
});
