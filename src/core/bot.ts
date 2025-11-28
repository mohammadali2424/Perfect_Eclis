
import { Bot, session } from "grammy";
import { BOT_TOKEN } from "./config";
import { supabase } from "./supabase";
import type { MyContext, SessionData, Services } from "./types";

import { registerSecurityFeature } from "../features/security/guard";
import { registerTravelFeature } from "../features/world/travel";
import { registerWorldAdminFeature } from "../features/world/admin-builder";
import { registerRegistrationFeature } from "../features/registration";
import { registerMainMenuFeature } from "../features/ui/main-menu";

export const bot = new Bot<MyContext>(BOT_TOKEN);

/**
 * سشن به ازای هر یوزر
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
      if (ctx.from) return `user:${ctx.from.id}`;
      if (ctx.chat) return `chat:${ctx.chat.id}`;
      return undefined;
    },
  })
);

/**
 * تزریق سرویس‌ها
 */
bot.use((ctx, next) => {
  ctx.services = {
    supabase,
  } as Services;
  return next();
});

/**
 * ثبت فیچرها
 */
registerSecurityFeature(bot);
registerMainMenuFeature(bot);
registerWorldAdminFeature(bot);
registerTravelFeature(bot);
registerRegistrationFeature(bot);
