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

export const bot = new Bot<MyContext>(BOT_TOKEN);

bot.use(
  session({
    initial: (): SessionData => ({
      ui_last_menu_id: undefined,
      reg_step: undefined,
      reg_clan: null,
      reg_name: null,
    }),
  })
);

bot.use((ctx, next) => {
  ctx.services = { supabase } as Services;
  return next();
});

registerSecurityFeature(bot);
registerOnboardingFeature(bot);
registerWorldAdminFeature(bot);
registerTravelFeature(bot);