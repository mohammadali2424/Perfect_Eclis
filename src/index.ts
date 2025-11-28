import express from "express";
import { webhookCallback } from "grammy";
import { bot } from "./core/bot.js";
import { PORT, WEBHOOK_SECRET } from "./core/config.js";
import { handleStart, handleMainMenuText } from "./features/world/onboarding.js";
import {
  handleWorldAdminCommand,
  handleWorldAdminCallback,
} from "./features/world/admin-builder.js";
import { handleNewChatMembers } from "./features/security/guard.js";

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

// کال‌بک‌های مدیریت جهان
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery?.data ?? "";
  if (data.startsWith("wa:")) {
    return handleWorldAdminCallback(ctx);
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

// وب‌سرور برای Webhook (سازگار با Render)
const app = express();

app.use(express.json());

// مسیر وبهوک
const webhookPath = `/bot/${WEBHOOK_SECRET || "no-secret"}`;
console.log("Using webhook path:", webhookPath);

app.use(webhookPath, webhookCallback(bot, "express"));

// روت ساده برای چک سلامت
app.get("/", (_req, res) => {
  res.status(200).send("Eclis Pathweaver bot is running.");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT} (webhook mode)`);
});
