import { bot } from "./core/bot";

// برای توسعهٔ لوکال: لانگ پولینگ
if (!process.env.WEBHOOK_MODE) {
  console.log("Starting bot in long-polling mode...");
  bot.start();
} else {
  // برای Render باید وبهوک رو روی HTTP هندلر ست کنی.
  console.log("WEBHOOK_MODE is enabled. Configure HTTP webhook handler for your platform.");
}