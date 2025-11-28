import { webhookCallback } from "grammy";
import express, { Request, Response } from "express";
import { bot } from "./core/bot";
import { createBot } from "./core/bot";

const app = express();
const port = process.env.PORT || 3000;
const bot = createBot();

if (process.env.WEBHOOK_URL) {
  // اگر بعداً وبهوک تنظیم کردی
  bot.start();
} else {
  // لانگ پولینگ ساده
  bot.start();
}

app.use(express.json());

// تلگرام اینجا آپدیت‌ها رو POST می‌کنه
app.post("/webhook", webhookCallback(bot, "express"));

// روت تست ساده
app.get("/", (req: Request, res: Response) => {
  res.send("Eclis Pathweaver Bot Running");
});

app.listen(port, () => {
  console.log(`Bot webhook server running on port ${port}`);
});
