import { webhookCallback } from "grammy";
import express, { Request, Response } from "express";
import { createBot } from "./core/bot";

// بات را می‌سازیم
const bot = createBot();

// اگر لازم شد جای دیگه از همین bot استفاده کنی
export { bot };

const app = express();
const port = process.env.PORT || 3000;

// برای دریافت JSON از تلگرام
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
