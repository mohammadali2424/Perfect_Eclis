// src/index.ts
import express, { Request, Response } from "express";
import { webhookCallback } from "grammy";

// حواست باشه این .js آخر ایمپورت‌ها مهمه چون توی build به همین شکل استفاده میشه
import { bot } from "./core/bot.js";
import { BOT_TOKEN, PORT } from "./core/config.js";

import {
  handleStart,
  handleMainMenuText,
  handleOnboardingCallback,
} from "./features/world/onboarding.js";

import {
  handleWorldAdminCommand,
  handleWorldAdminCallback,
  handleWorldAdminText,
} from "./features/world/admin-builder.js";

import { handleTravelCallback } from "./features/world/travel.js";
import { handleNewChatMembers } from "./features/security/guard.js";

// -------------------- ثبت هندلرها روی bot --------------------

// /start فقط توی PV منطقیه
bot.command("start", handleStart);

// پنل مسیرسازی در گروه‌ها
bot.command("aw", handleWorldAdminCommand);

// جوین جدید تو گروه‌ها → گارد
bot.on("message:new_chat_members", handleNewChatMembers);

// کال‌بک‌ها (دکمه‌های اینلاین)
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery?.data ?? "";

  if (data.startsWith("onboard:")) {
    return handleOnboardingCallback(ctx);
  }

  if (data.startsWith("wa:")) {
    return handleWorldAdminCallback(ctx);
  }

  if (data.startsWith("travel:")) {
    return handleTravelCallback(ctx);
  }
});

// متن‌ها
bot.on("message:text", async (ctx) => {
  if (ctx.chat.type === "private") {
    // منوی فانتزی PV (مسیرهای من، نقشه سریع من، حالت‌ها)
    await handleMainMenuText(ctx);
    return;
  }

  // توی گروه‌ها: متن‌ها برای پنل world admin
  await handleWorldAdminText(ctx);
});

// یک لاگ ساده برای همه پیام‌ها
bot.on("message", (ctx) => {
  console.log(
    "[MSG]",
    "from", ctx.from?.id,
    "in", ctx.chat?.id,
    "text:", ctx.message?.text,
  );
});

// هندلر کلی ارور
bot.catch((err) => {
  console.error("Bot error:", err.error);
});

// -------------------- بخش وبهوک (Express) --------------------

const app = express();
const port = PORT || process.env.PORT || 3000;

// یک مسیر مخفی‌تر برای وبهوک
const secretPath = `/bot/${BOT_TOKEN.split(":")[0]}`;

app.use(express.json());

// روت تست
app.get("/", (_req: Request, res: Response) => {
  res.send("Eclis Pathweaver Bot (Webhook) is running.");
});

// مسیر وبهوک که تلگرام بهش POST می‌فرسته
app.post(secretPath, webhookCallback(bot, "express"));

// ران شدن سرور HTTP
app.listen(port, () => {
  console.log(`🚀 Webhook server running on port ${port}`);
  console.log(`🔗 Webhook path: ${secretPath}`);
});
