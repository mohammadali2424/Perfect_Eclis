import { webhookCallback } from "grammy";
import express, { Request, Response } from "express";
import { bot } from "./core/bot";

const app = express();
const port = process.env.PORT || 3000;

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
