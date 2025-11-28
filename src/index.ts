// src/index.ts
import express, { Request, Response } from "express";
import { webhookCallback } from "grammy";

// حواست باشه پسوند .js مهمه چون خروجی tsc این‌طوری میشه
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

// /start → ثبت‌نام / ورود به منو
bot.command("start", handleStart);

// /aw → پنل ساخت جهان در گروه‌ها
bot.command("aw", handleWorldAdminCommand);

// جوین جدید به گروه
bot.on("message:new_chat_members", handleNewChatMembers);

// کال‌بک دکمه‌های اینلاین
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
    // منوی فانتزی PV
    await handleMainMenuText(ctx);
    return;
  }

  // توی گروه‌ها → متن در مود world admin
  await handleWorldAdminText(ctx);
});

// لاگ برای همه پیام‌ها
bot.on("message", (ctx) => {
  console.log(
    "[MSG]",
    "from", ctx.from?.id,
    "in", ctx.chat?.id,
    "text:", ctx.message?.text,
  );
});

// هندل ارورها
bot.catch((err) => {
  console.error("Bot error:", err.error);
});

// ❗ دقت کن: این‌جا **دیگه bot.start() نداریم**
// -------------------- راه‌اندازی وبهوک با Express --------------------

const app = express();
const port = PORT || process.env.PORT || 3000;

// مسیر مخفی برای وبهوک
const secretPath = `/bot/${BOT_TOKEN.split(":")[0]}`;

app.use(express.json());

// روت تست
app.get("/", (_req: Request, res: Response) => {
  res.send("Eclis Pathweaver Bot (Webhook) is running.");
});

// همین مسیر، وبهوک رسمی ماست
app.post(secretPath, webhookCallback(bot, "express"));

// ران شدن سرور HTTP
app.listen(port, () => {
  console.log(`🚀 Webhook server running on port ${port}`);
  console.log(`🔗 Webhook path: ${secretPath}`);
});
