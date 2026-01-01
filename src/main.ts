import http, { type IncomingMessage, type ServerResponse } from "node:http";

import { env } from "./config/env.js";
import { createLogger } from "./core/utils/logger.js";
import { createBot } from "./core/bot/createBot.js";
import { CommandRegistry } from "./core/commands/registry.js";
import { MemoryUnitOfWork } from "./adapters/storage/memory.js";

import { registerSystemModule } from "./modules/system/index.js";
import { registerXpModule } from "./modules/xp/index.js";
import { registerAdminModule } from "./modules/admin/index.js";

const logger = createLogger('info');

// Storage / Unit of Work
const uowFactory = () => new MemoryUnitOfWork();

// Commands
const registry = new CommandRegistry();
registerSystemModule(registry);
registerXpModule(registry);
registerAdminModule(registry);

// Bot
const bot = createBot({
  token: env.BOT_TOKEN,
  registry,
  uowFactory,
  logger,
});

// Webhook server (Render)
const port = env.PORT;
const webhookPath = env.WEBHOOK_PATH || "/telegram";

const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
  if (!req.url) {
    res.statusCode = 404;
    res.end();
    return;
  }

  // Telegraf v4: callback handles only matching path.
  if (req.url.split("?")[0] !== webhookPath) {
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("ok");
    return;
  }

  const cb = bot.webhookCallback(webhookPath, {
    secretToken: env.WEBHOOK_SECRET || undefined,
  });
  return (cb as any)(req, res);
});

server.listen(port, async () => {
  logger.info("HTTP server listening", { port, webhookPath });

  // If BASE_URL is provided, set webhook.
  const baseUrl = (env.BASE_URL || "").trim();
  if (baseUrl) {
    const url = `${baseUrl.replace(/\/$/, "")}${webhookPath}`;
    try {
      await bot.telegram.setWebhook(url, {
        secret_token: env.WEBHOOK_SECRET || undefined,
      });
      logger.info("Webhook set", { url });
    } catch (err) {
      logger.error("Failed to set webhook", { err, url });
    }
  } else {
    logger.warn("BASE_URL is empty; webhook not set automatically");
  }
});

// Graceful shutdown
process.once("SIGINT", () => {
  logger.warn("SIGINT received, stopping bot");
  bot.stop("SIGINT");
  server.close();
});

process.once("SIGTERM", () => {
  logger.warn("SIGTERM received, stopping bot");
  bot.stop("SIGTERM");
  server.close();
});
