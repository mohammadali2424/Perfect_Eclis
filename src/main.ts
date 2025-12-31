import { createServer } from "node:http";

import { env } from "./config/env.js";
import { createBot } from "./core/bot/createBot.js";
import { CommandRegistry } from "./core/commands/registry.js";
import { createLogger } from "./core/utils/logger.js";
import { MemoryUnitOfWork } from "./adapters/storage/memory.js";

import { registerHelpModule } from "./modules/help/index.js";
import { registerXpModule } from "./modules/xp/index.js";
import { registerAdminModule } from "./modules/admin/index.js";

const logger = createLogger(env.LOG_LEVEL);

const registry = new CommandRegistry();
registerHelpModule(registry);
registerXpModule(registry);
registerAdminModule(registry);

// فعلاً روی Memory هستیم (پلن رایگان). بعداً همین uowFactory را با Supabase/DB واقعی سوییچ می‌کنیم.
const uowFactory = () => new MemoryUnitOfWork();

const bot = createBot({
  token: env.BOT_TOKEN,
  registry,
  uowFactory,
  logger,
  auth: {
    ownerId: env.OWNER_ID,
    adminIds: env.ADMIN_IDS,
  },
});

const webhookPath = env.WEBHOOK_PATH || "/telegram";
const port = env.PORT || 10000;

const server = createServer((req, res) => {
  try {
    const url = req.url || "/";

    // Healthcheck
    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // برای جلوگیری از "Cannot GET /telegram"
    if (req.method === "GET" && url === webhookPath) {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("OK");
      return;
    }

    // Webhook: فقط POST
    if (req.method === "POST" && url === webhookPath) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const update = body ? JSON.parse(body) : {};
          await bot.handleUpdate(update);
          res.writeHead(200);
          res.end("OK");
        } catch (e) {
          logger.error({ err: e }, "Webhook update handling failed");
          res.writeHead(200);
          res.end("OK"); // تلگرام باید 200 بگیرد، وگرنه retry می‌کند
        }
      });
      return;
    }

    // Not found
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "Not Found" }));
  } catch (e) {
    logger.error({ err: e }, "HTTP server error");
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "Server error" }));
  }
});

server.listen(port, async () => {
  logger.info({ port, webhookPath }, "HTTP server listening");

  // اگر BASE_URL خالی باشد، ست‌کردن وبهوک را انجام نمی‌دهیم (برای لوکال/تست).
  if (!env.BASE_URL) {
    logger.warn("BASE_URL is empty; webhook not set automatically");
    return;
  }

  const webhookUrl = new URL(webhookPath, env.BASE_URL).toString();
  try {
    await bot.telegram.setWebhook(webhookUrl);
    logger.info({ url: webhookUrl }, "Webhook set");
  } catch (e) {
    logger.error({ err: e, url: webhookUrl }, "Failed to set webhook");
  }
});
