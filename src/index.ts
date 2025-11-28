// src/index.ts
import express from "express";
import { bot } from "./core/bot.js";
import { PORT, BOT_TOKEN } from "./core/config.js";

import { handleStart, handleMainMenuText } from "./features/world/onboarding.js";
import {
  handleWorldAdminCommand,
  handleWorldAdminCallback,
  handleWorldAdminText,
} from "./features/world/admin-builder.js";
import { handleNewChatMembers } from "./features/security/guard.js";
import { handleTravelCallback } from "./features/world/travel.js";
import { webhookCallback } from "grammy";

// دستورات و هندلرها

bot.command("start", handleStart);

bot.command("ping", async (ctx) => {
  await ctx.reply("pong 🧬");
});

bot.hears(
  [
    "🧭 مسیرهای من",
    "🗺 نقشهٔ سریع من",
    "🚶 حالت پیاده",
    "🐎 حالت سوارکار",
    "🚗 حالت راننده",
    "🎈 حمل و نقل",
  ],
  handleMainMenuText,
);

bot.command("aw", handleWorldAdminCommand);

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery?.data ?? "";
  if (data.startsWith("wa:")) {
    return handleWorldAdminCallback(ctx);
  }
  if (data.startsWith("travel:")) {
    return handleTravelCallback(ctx);
  }
});

bot.on("message:text", handleWorldAdminText);

bot.on("message:new_chat_members", handleNewChatMembers);

bot.on("message", (ctx) => {
  console.log(
    "Incoming message from",
    ctx.from?.id,
    "in chat",
    ctx.chat?.id,
    "text:",
    ctx.message?.text,
  );
});

bot.catch((err) => {
  console.error("Bot error:", err.error);
});

// ---- اینجا قسمت Webhook / Polling ----

const app = express();
app.use(express.json());

// URL مخفی‌تر بسازیم:
const secretPath = `/bot/${BOT_TOKEN.split(":")[0]}`;

app.get("/", (_req, res) => {
  res.status(200).send("Eclis Pathweaver bot is running with webhook.");
});

// تلگرام اینجا آپدیت‌ها را POST می‌کند
app.post(secretPath, webhookCallback(bot, "express"));

// روی Render فقط سرور HTTP لازم داریم
app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
  console.log(`Webhook path: ${secretPath}`);
});

// نکته: دیگه اینجا bot.start() نداریم
