import http, { type IncomingMessage, type ServerResponse } from "node:http";

import { env } from "./config/env.js";
import { createLogger } from "./core/utils/logger.js";
import { createBot } from "./core/bot/createBot.js";
import { CommandRegistry } from "./core/commands/registry.js";
import { MemoryUnitOfWork } from "./adapters/storage/memory.js";
import { registerSystemModule } from "./modules/system/index.js";
import { registerXpModule } from "./modules/xp/index.js";
import { authority } from "./core/authority/singleton.js";
import { TelegramAuditLog } from "./adapters/audit/telegramAuditLog.js";
import { registerChatSettingsCommands } from "./modules/admin/chatSettingsCommands.js";
import { registerAdminCommands } from "./modules/admin/adminCommands.js";

const logger = createLogger('info');

// Storage / Unit of Work (Memory - shared)
const sharedUow = new MemoryUnitOfWork();
const uowFactory = () => sharedUow;


// Commands
const registry = new CommandRegistry();
registerSystemModule(registry);
registerXpModule(registry);
registerAdminCommands(registry);
registerChatSettingsCommands(registry);

// Bot
const bot = createBot({
  token: env.BOT_TOKEN,
  registry,
  uowFactory,
  logger,
  buildAuditLog: (telegram, uowFactory) =>
    new TelegramAuditLog(telegram, async () => {
      const uow = uowFactory() as any;
      const s = await uow.chatSettings.getSnapshot();
      return s.logChatId ?? null;
    }),
});

const auditLog = new TelegramAuditLog(bot.telegram, async () => {
  const uow = uowFactory() as any;
  const s = await uow.chatSettings.getSnapshot();
  return s.logChatId ?? null;
});


const botMode = (process.env.BOT_MODE || "webhook").toLowerCase();


// ----------------------------
// BOT MODE: POLLING (LOCAL)
// ----------------------------
if (botMode === "polling") {
  (async () => {
    logger.info("Starting bot in polling mode");
    await bot.launch();
    logger.info("Bot launched (polling)");
  })();

  const shutdown = (signal: "SIGINT" | "SIGTERM") => {
    logger.warn(`${signal} received, shutting down`);
    try {
      bot.stop(signal);
    } catch (err) {
      logger.warn("Bot stop skipped (probably not running)", { err });
    }
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

} else {
  // ----------------------------
  // BOT MODE: WEBHOOK (RENDER)
  // ----------------------------
  const port = Number(process.env.PORT) || 3000;
  const webhookPath = process.env.WEBHOOK_PATH || "/telegram";

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!req.url) {
      res.statusCode = 404;
      res.end();
      return;
    }

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

  const shutdown = (signal: "SIGINT" | "SIGTERM") => {
    logger.warn(`${signal} received, shutting down`);

    try {
      server.close(() => logger.info("HTTP server closed"));
    } catch (err) {
      logger.warn("HTTP server close failed/skipped", { err });
    }

    try {
      bot.stop(signal);
    } catch (err) {
      logger.warn("Bot stop skipped (probably not running)", { err });
    }
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}





