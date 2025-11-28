// src/index.ts
import express from "express";
import { webhookCallback } from "grammy";
import { bot } from "./core/bot.js";
import { BOT_TOKEN, PORT } from "./core/config.js";

// مسیر مخفی برای امنیت بیشتر:
const secretPath = `/bot/${BOT_TOKEN.split(":")[0]}`;

const app = express();
app.use(express.json());

// تست سرور
app.get("/", (_req, res) => {
  res.send("Eclis Pathweaver Webhook is alive.");
});

// مسیر Webhook
app.post(secretPath, webhookCallback(bot, "express"));

// اجرا
app.listen(PORT, () => {
  console.log("🚀 Webhook server running on port", PORT);
  console.log("🔗 Webhook path:", secretPath);
});
