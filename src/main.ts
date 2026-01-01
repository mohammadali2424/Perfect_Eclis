import express from 'express';
import { env } from './config/env.js';
import { createLogger } from './core/utils/logger.js';
import { CommandRegistry } from './core/commands/registry.js';
import { createBot } from './core/bot/createBot.js';

import { MemoryUnitOfWork } from './adapters/storage/memory.js';

import { registerHelpModule } from './modules/help/index.js';
import { registerSystemModule } from './modules/system/index.js';
import { registerXpModule } from './modules/xp/index.js';
import { registerAdminCommands } from "./modules/admin/index.js";
import { createMemoryAdminStore } from "./modules/admin/adminStore.memory.js";


const logger = createLogger(env.NODE_ENV === 'development' ? 'debug' : 'info');

const ownerId = Number(process.env.OWNER_ID || 0);
if (!ownerId) {
  logger.warn("OWNER_ID is not set; admin commands will be effectively locked.");
}

const adminsStore = createMemoryAdminStore(); // فعلاً خالی؛ با دستور داخل ربات پر می‌شود

registerAdminCommands(registry, { ownerId, admins: adminsStore });


if (!env.BOT_TOKEN) throw new Error('BOT_TOKEN is required');

const registry = new CommandRegistry();
registerHelpModule(registry);
registerSystemModule(registry);
registerXpModule(registry);
registerAdminModule(registry);

const uowFactory = () => new MemoryUnitOfWork();

const bot = createBot({
  token: env.BOT_TOKEN,
  registry,
  uowFactory,
  logger,
});

const app = express();

app.get('/health', (_req, res) => res.status(200).send('ok'));

app.use(express.json());

const webhookPath = env.WEBHOOK_PATH.startsWith('/') ? env.WEBHOOK_PATH : `/${env.WEBHOOK_PATH}`;

// نکته حیاتی: webhookCallback نباید زیر app.use(webhookPath, ...) mount شود.
// باید دقیقاً روی همون مسیر با POST بسته شود.
app.post(
  webhookPath,
  bot.webhookCallback(webhookPath, env.WEBHOOK_SECRET ? { secretToken: env.WEBHOOK_SECRET } : undefined),
);

app.listen(env.PORT, async () => {
  logger.info('HTTP server listening', { port: env.PORT, webhookPath });

  if (!env.BASE_URL) {
    logger.warn('BASE_URL is empty; webhook not set automatically');
    return;
  }

  const url = `${env.BASE_URL}${webhookPath}`;
  try {
    await bot.telegram.setWebhook(url, env.WEBHOOK_SECRET ? { secret_token: env.WEBHOOK_SECRET } : undefined);
    logger.info('Webhook set', { url });
  } catch (err) {
    logger.error('Failed to set webhook', { err });
  }
});
