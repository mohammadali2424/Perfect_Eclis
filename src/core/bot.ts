import { Bot, session, Keyboard } from "grammy";
import { BOT_TOKEN, MASTER_ID } from "./config";
import { supabase } from "./supabase";
import { MyContext, SessionData, Services } from "./types";

import { registerSecurityFeature } from "../features/security/guard";
import { registerTravelFeature } from "../features/world/travel";
import { registerWorldAdminFeature } from "../features/world/admin-builder";
import { registerRegistrationFeature } from "../features/registration";
import { registerOnboardingFeature } from "../features/world/onboarding";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required");
}

// خود بات
export const bot = new Bot<MyContext>(BOT_TOKEN);

// فقط برای اینکه MASTER_ID بی‌استفاده نمونده باشه و اگه noUnusedLocals روشنه گیر نده
console.log("[config] MASTER_ID =", MASTER_ID);

// سشن گرامی
bot.use(
  session({
    initial(): SessionData {
      // هیچ فیلد اضافه‌ای اینجا تعریف نمی‌کنیم
      // توی فیچرها از `ctx.session as any` استفاده می‌کنیم
      return {} as SessionData;
    },
  })
);

// تزریق supabase توی ctx.services
bot.use((ctx, next) => {
  ctx.services = {
    supabase,
  } as Services;
  return next();
});

// /start ساده + کیبورد اصلی PV
bot.command("start", async (ctx) => {
  const kb = new Keyboard()
    .text("🧭 مسیر های من")
    .row()
    .text("🗺 نقشه سریع من")
    .resized();

  await ctx.reply(
    "به Pathweaver خوش اومدی.\n" +
      "من مسیریاب جهان اکلیس‌ام.\n\n" +
      "از دکمه‌ی «🧭 مسیر های من» برای دیدن راه‌هایی که جلو پات بازه استفاده کن.\n" +
      "قبلش باید ارباب تو رو ثبت و تأیید کنه.",
    { reply_markup: kb }
  );
});

// رجیستر کردن فیچرها
registerSecurityFeature(bot);
registerOnboardingFeature(bot);
registerWorldAdminFeature(bot);
registerTravelFeature(bot);
registerRegistrationFeature(bot);
