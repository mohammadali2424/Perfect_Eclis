// @ts-nocheck
import { Bot, session } from "grammy";
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

// رجیستر همه فیچرها (ترتیب مهمه: سیکیوریتی / آن‌بوردینگ / رجیستریشن / ادمین / سفر)
registerSecurityFeature(bot);
registerOnboardingFeature(bot);
registerRegistrationFeature(bot);
registerWorldAdminFeature(bot);
registerTravelFeature(bot);
