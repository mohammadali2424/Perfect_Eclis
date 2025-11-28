import express from "express";
import { bot } from "./core/bot.js";
import { PORT } from "./core/config.js";
import { handleStart, handleMainMenuText } from "./features/world/onboarding.js";
import {
  handleWorldAdminCommand,
  handleWorldAdminCallback,
} from "./features/world/admin-builder.js";
import { handleNewChatMembers } from "./features/security/guard.js";
import { handleTravelCallback } from "./features/world/travel.js";

// دستورات پایه
bot.command("start", handleStart);

// تست زنده بودن ربات
bot.command("ping", async (ctx) => {
  await ctx.reply("pong 🧬");
});

// منوی PV
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

// پنل مدیریت جهان
bot.command("worldadmin", handleWorldAdminCommand);

// کال‌بک‌های اینلاین
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery?.data ?? "";
  if (data.startsWith("wa:")) {
    return handleWorldAdminCallback(ctx);
  }
  if (data.startsWith("travel:")) {
    return handleTravelCallback(ctx);
  }
});

// گارد اضافه‌شدن به گروه‌ها
bot.on("message:new_chat_members", handleNewChatMembers);

// لاگ ساده برای هر پیام
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

// هندل خطا
bot.catch((err) => {
  console.error("Bot error:", err.error);
});

// ---- سرور ساده برای Render (فقط برای پورت) ----
const app = express();

app.get("/", (_req, res) => {
  res
    .status(200)
    .send("Eclis Pathweaver bot is running (polling mode with travel).");
});

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// ---- شروع Polling ----
bot.start();
console.log("Bot started in long-polling mode");
