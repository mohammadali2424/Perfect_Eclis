import { Bot, session } from "grammy";
import { BOT_TOKEN } from "./config";
import { supabase } from "./supabase";
import { MyContext, SessionData, Services } from "./types";

import { registerSecurityFeature } from "../features/security/guard";
import { registerTravelFeature } from "../features/world/travel";
import { registerWorldAdminFeature } from "../features/world/admin-builder";
import { registerOnboardingFeature } from "../features/world/onboarding";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required");
}

// خود بات اصلی
export const bot = new Bot<MyContext>(BOT_TOKEN);

// سشن گرامی (حافظه موقت برای هر یوزر)
bot.use(
  session({
    initial: (): SessionData => ({
      // هر چیزی توی SessionData هست می‌تونه اینجا مقدار اولیه بگیره
      ui_last_menu_id: undefined,
      reg_step: undefined,
      reg_clan: null,
      reg_name: null,
      // اگر توی SessionData چیزای دیگه‌ای هم داری، گرامی خودش بعداً اضافه می‌کنه
    }),
  })
);

// تزریق سرویس‌ها (مثل supabase) داخل ctx.services
bot.use((ctx, next) => {
  ctx.services = {
    supabase,
  } as Services;
  return next();
});

// فیچرهای مختلف ربات
registerSecurityFeature(bot);        // محافظت: ارباب، لفت از گروه‌های اضافی و…
registerOnboardingFeature(bot);      // اطلس، ثبت‌نام، انتخاب خاندان
registerWorldAdminFeature(bot);      // پنل ساخت Region/Spot/Edge
registerTravelFeature(bot);          // سفر بین مسیرها، مسیرهای من، نقشه سریع من
