import { Bot, session } from "grammy";
import { BOT_TOKEN } from "./config";
import { supabase } from "./supabase";
import { MyContext, SessionData, Services } from "./types";
import { registerWorldAdminCommands } from "../features/worldbuilder/admin-commands";
import { registerSecurityFeature } from "../features/security/guard";
import { registerTravelFeature } from "../features/world/travel";
import { registerPathBuilderFeature } from "../features/worldbuilder/path-builder";
import { registerVehicleTravelFeature } from "../features/world/travel-vehicles";
import { registerWorldVehicleShop } from "../features/economy/vehicle-shop";
import { registerWorldAdminFeature } from "../features/worldbuilder/admin-builder";
import { registerOnboardingFeature } from "../features/world/onboarding";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required");
}

export const bot = new Bot<MyContext>(BOT_TOKEN);

// سشن مینیمال برای ثبت‌نام و ui
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

// تزریق سرویس‌ها (فعلاً فقط supabase)
bot.use((ctx, next) => {
  ctx.services = { supabase } as Services;
  return next();
});

// رجیستر تمام فیچرها
registerSecurityFeature(bot);
registerWorldAdminCommands(bot);
registerVehicleTravelFeature(bot);
registerPathBuilderFeature(bot);
registerOnboardingFeature(bot);
registerWorldAdminFeature(bot);
registerWorldVehicleShop(bot);
registerTravelFeature(bot);
