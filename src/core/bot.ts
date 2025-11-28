// src/core/bot.ts
import { Bot, session } from "grammy";
import { BOT_TOKEN } from "./config";
import { supabase } from "./supabase";
import type { MyContext, SessionData, Services } from "./types";

import { registerSecurityFeature } from "../features/security/guard";
import { registerTravelFeature } from "../features/world/travel";
import { registerWorldAdminFeature } from "../features/world/admin-builder";
import { registerRegistrationFeature } from "../features/registration";
import { registerMainMenuFeature } from "../features/ui/main-menu";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required");
}

/**
 * خود بات اصلی اکلیس
 */
export const bot = new Bot<MyContext>(BOT_TOKEN);

/**
 * سشن گرامی (حافظه‌ی موقت برای هر یوزر)
 */
bot.use(
  session({
    initial: (): SessionData => ({
      // پیام آخر توی پی‌وی برای تمیز نگه داشتن چت
      __last_pm_id: undefined,

      // وضعیت پنل دنیاسازی (world admin)
      worldAdmin: undefined,

      // آخرین منوی UI (اگر خواستی بعداً ازش استفاده کنی)
      ui_last_menu_id: undefined,

      // ویزارد ثبت‌نام
      reg_step: undefined,
      reg_clan: null,
      reg_name: null,
    }),
  })
);

/**
 * تزریق سرویس‌ها داخل ctx.services
 * الان فقط supabase داریم، بعداً هرچی خواستی اضافه می‌کنی.
 */
bot.use((ctx, next) => {
  ctx.services = {
    supabase,
  } as Services;
  return next();
});

/**
 * رجیستر کردن همه‌ی فیچرها
 */
registerSecurityFeature(bot);       // محافظت: ارباب، لفت از گروه‌های اضافی و…
registerMainMenuFeature(bot);      // کیبورد «مسیرهای من» و «نقشه سریع من»
registerWorldAdminFeature(bot);    // پنل ساخت Region/Spot/Edge در پی‌وی ارباب
registerTravelFeature(bot);        // سفر بین مسیرها، /path، مسیرهای من، نقشه‌ی سریع
registerRegistrationFeature(bot);  // ثبت‌نام بازیکنان و تایید توسط ارباب
