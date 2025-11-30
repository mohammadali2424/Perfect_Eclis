import express from "express";
import { webhookCallback } from "grammy";
import { bot } from "./core/bot";

const app = express();
const PORT = process.env.PORT || 3000;

// برای اینکه تلگرام بتونه JSON بفرسته
app.use(express.json());

// تست ساده که ببینی سرویس بالا اومده
app.get("/", (_req, res) => {
  res.send("Pathweaver is alive ✨");
});

// وبهوک اصلی تلگرام
app.post(
  "/webhook",
  webhookCallback(bot, "express")
);

// استارت سرور
app.listen(PORT, () => {
  console.log(`Bot server listening on port ${PORT}`);
});
