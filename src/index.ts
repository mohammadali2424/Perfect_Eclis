import { webhookCallback } from "grammy";
import express, { Request, Response } from "express";
import { bot } from "./core/bot";

const app = express();
const port = process.env.PORT || 3000;

// برای اینکه تلگرام JSON بفرسته و ما بخونیم
app.use(express.json());

// Webhook endpoint که تلگرام بهش آپدیت‌ها رو POST می‌کنه
app.post("/webhook", webhookCallback(bot, "express"));

// یه روت ساده برای تست سالم بودن سرویس
app.get("/", (req: Request, res: Response) => {
  res.send("Eclis Pathweaver Bot Running");
});

// سرور رو روی پورتی که Render می‌ده بالا میاریم
app.listen(port, () => {
  console.log(`Bot webhook server running on port ${port}`);
});
