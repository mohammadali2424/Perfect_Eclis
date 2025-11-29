// @ts-nocheck
import { Bot, session, Keyboard } from "grammy";
import { BOT_TOKEN } from "./config";
import { supabase } from "./supabase";
import { MyContext, SessionData, Services } from "./types";

import { registerSecurityFeature } from "../features/security/guard";
import { registerOnboardingFeature } from "../features/world/onboarding";
import { registerWorldAdminFeature } from "../features/world/admin-builder";
import { registerTravelFeature } from "../features/world/travel";
import { registerRegistrationFeature } from "../features/registration";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required");
}

// خود بات
export const bot = new Bot<MyContext>(BOT_TOKEN);

// سشن
bot.use(
  session({
    initial(): SessionData {
      return {} as SessionData;
    },
  })
);

// سرویس‌ها (Supabase و غیره)
bot.use((ctx, next) => {
  ctx.services = {
    supabase,
  } as Services;
  return next();
});

// فقط برای مطمئن شدن از اینکه این bot.ts واقعاً لود شده
bot.command("debug_alive", async (ctx) => {
  await ctx.reply("✅ Core bot زنده است و bot.ts درست لود شده.");
});

// /start ساده برای PV که منو رو ست کند
bot.command("start", async (ctx) => {
  if (ctx.chat.type !== "private") return;

  const kb = new Keyboard()
    .text("🧭 مسیر های من")
    .row()
    .text("🗺 نقشه سریع من")
    .row()
    .text("ثبت من")
    .resized();

  await ctx.reply(
    "به Pathweaver خوش اومدی.\n" +
      "من مسیریاب جهان اکلیس‌ام.\n\n" +
      "برای ثبت‌نام از دکمه‌ی «ثبت من» استفاده کن.\n" +
      "بعد از تأیید ارباب، مسیرها برات باز می‌شن.",
    { reply_markup: kb }
  );
});

// 🔴 نکته مهم: ترتیب رجیستر فیچرها
// اول: آنبوردینگ، رجیستریشن، ساخت جهان، سفر
// آخر: سکیوریتی، که چیزی رو قورت نده قبل از این‌ها

registerOnboardingFeature(bot);
registerRegistrationFeature(bot);
registerWorldAdminFeature(bot);
registerTravelFeature(bot);
registerSecurityFeature(bot);
