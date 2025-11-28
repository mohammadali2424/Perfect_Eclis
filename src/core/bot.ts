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
 * نکته‌ی مهم: سشن رو روی "کاربر" می‌ذاریم نه روی "چت"
 * تا وقتی توی گروه /worldadmin می‌زنی و بعد تو PV دکمه‌ها رو می‌زنی،
 * worldAdmin توی همون سشن باقی بمونه.
 */
bot.use(
  session({
    initial: (): SessionData => ({
      __last_pm_id: undefined,
      worldAdmin: undefined,
      ui_last_menu_id: undefined,
      reg_step: undefined,
      reg_clan: null,
      reg_name: null,
    }),
    getSessionKey: (ctx) => {
      // سشن رو به ازای هر یوزر بساز، نه به ازای هر چت
      if (ctx.from) {
        return `user:${ctx.from.id}`;
      }
      // اگر از کانالی چیزی بیاد که from نداره، می‌تونیم سشن نداشته باشیم
      if (ctx.chat) {
        return `chat:${ctx.chat.id}`;
      }
      return undefined;
    },
  })
);

/**
 * تزریق سرویس‌ها داخل ctx.services
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
