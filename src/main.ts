// src/main.ts
import { env } from "./config/env.js";
import { createBot } from "./core/bot/createBot.js";
import { CommandRegistry } from "./core/commands/registry.js";
import { createLogger } from "./core/logger/logger.js";
import { createMemoryUnitOfWork } from "./adapters/storage/memory.js";

import { registerSystemModule } from "./modules/system/index.js";
import { registerXpModule } from "./modules/xp/index.js";
import { registerAdminModule } from "./modules/admin/index.js";

const logger = createLogger(env.LOG_LEVEL);

// 1) اول registry ساخته می‌شود
const registry = new CommandRegistry();

// 2) بعد ماژول‌ها رجیستر می‌شوند
registerSystemModule(registry);
registerXpModule(registry);
registerAdminModule(registry);

// 3) بعد bot ساخته می‌شود
const bot = createBot({
  token: env.BOT_TOKEN,
  registry,
  uowFactory: createMemoryUnitOfWork,
  logger,
});

async function main() {
  const port = env.PORT;
  const webhookPath = env.WEBHOOK_PATH;

  await bot.launchWebhook({
    port,
    webhookPath,
    baseUrl: env.BASE_URL,
    secretToken: env.WEBHOOK_SECRET,
  });

  logger.info(`HTTP server listening on port=${port} webhookPath=${webhookPath}`);
}

main().catch((err) => {
  logger.error(String(err));
  process.exit(1);
});
