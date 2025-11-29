import { Bot, session } from "grammy";
import { supabase } from "./supabase";
import { BOT_TOKEN } from "./config";
import { MyContext, SessionData, Services } from "./types";

// ساخت خود bot
export const bot = new Bot<MyContext>(BOT_TOKEN);

// اینجا: تنظیم سشن
bot.use(
  session({
    initial: (): SessionData => ({
      ui_last_menu_id: undefined,
      reg_step: undefined,
      reg_clan: null,
      reg_name: null,

      // فیلدهایی که پنل ادمین استفاده می‌کنه
      __admin_source_chat_id: undefined,
      __admin_source_chat_title: undefined,
      __admin_state: undefined,
      __current_region_id: undefined,
      __edge_src_spot_id: undefined,
      __edge_dst_spot_id: undefined,
      __last_pm_id: undefined,
    }),

    // سشن بر اساس یوزر، نه بر اساس چت
    getSessionKey: (ctx) => {
      if (ctx.from) {
        return `u:${ctx.from.id}`;
      }
      return undefined;
    },
  })
);

// سرویس‌ها (سوپابیس و ... )
bot.use((ctx, next) => {
  ctx.services = {
    supabase,
  } as Services;
  return next();
});

registerSecurityFeature(bot);
registerOnboardingFeature(bot);
registerWorldAdminFeature(bot);
registerTravelFeature(bot);
registerRegistrationFeature(bot);
