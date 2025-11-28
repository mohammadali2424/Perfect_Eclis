// src/index.ts
import express, { Request, Response } from "express";
import { bot } from "./core/bot.js";
import { PORT } from "./core/config.js";

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

// /start → ثبت‌نام / ورود به منوی اصلی
bot.command("start", handleStart);

// پنل ساخت جهان در گروه‌ها
bot.command("aw", handleWorldAdminCommand);

// ورود یوزر جدید به گروه → گارد
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
    // منوی فانتزی PV: مسیرهای من، نقشه سریع، حالت‌ها
    await handleMainMenuText(ctx);
    return;
  }

  // توی گروه‌ها → متن برای مود world admin
  await handleWorldAdminText(ctx);
});

// لاگ ساده
bot.on("message", (ctx) => {
  console.log(
    "[MSG]",
    "from", ctx.from?.id,
    "in", ctx.chat?.id,
    "text:", ctx.message?.text,
  );
});

// هندل ارورهای گرامی
bot.catch((err) => {
  console.error("Bot error:", err.error);
});

// -------------------- Polling + Express برای Render --------------------

// این خط، همون long-polling معروفه
bot.start();
console.log("🤖 Bot started in long-polling mode");

// برای اینکه Render گیر نده «port باز نیست»، یه Express سبک میاریم بالا
const app = express();
const port = PORT || process.env.PORT || 3000;

app.get("/", (_req: Request, res: Response) => {
  res.send("Eclis Pathweaver Bot is running (long-polling).");
});

app.listen(port, () => {
  console.log(`🌐 HTTP server listening on port ${port}`);
});
