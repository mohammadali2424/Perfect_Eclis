import { bot } from "./core/bot";

// For local dev you can use long polling:
if (!process.env.WEBHOOK_MODE) {
  console.log("Starting bot in long-polling mode...");
  bot.start();
} else {
  // For Render/webhook deployment, you will expose a handler here.
  // See grammY webhook docs and Render docs to wire this up.
  console.log("WEBHOOK_MODE is enabled. Please configure the HTTP handler according to your platform.");
}