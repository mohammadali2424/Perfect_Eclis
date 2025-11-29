import { Bot, session } from "grammy";
import { BOT_TOKEN } from "./config";
import { registerRegistrationFeature } from "../features/players/registration";
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

// ساخت بات
export const bot = new Bot<MyContext>(BOT_TOKEN);

// سشن: همون فیلدهای قبلی + تبدیلش به user-based
bot.use(
  session({
    initial: (): SessionData => ({
      ui_last_menu_id: undefined,
      reg_step: undefined,
      reg_clan: null,
      reg_name: null,
      // هیچ فیلد اضافه‌ای اینجا نذار، چون SessionData دقیق تعریف شده
    }),
    // سشن بر اساس یوزر، نه چت → گروه و PV برای یک یوزر، سشن مشترک می‌گیرن
    getSessionKey: (ctx) => {
      if (ctx.from) {
        return `u:${ctx.from.id}`;
      }
      return undefined;
    },
  })
);

// تزریق سرویس‌ها (مثل supabase) توی ctx
bot.use((ctx, next) => {
  ctx.services = {
    supabase,
  } as Services;
  return next();
});

// رجیستر کردن فیچرها
registerSecurityFeature(bot);
registerOnboardingFeature(bot);
registerWorldAdminFeature(bot);
  registerRegistrationFeature(bot);
registerTravelFeature(bot);
registerRegistrationFeature(bot);
