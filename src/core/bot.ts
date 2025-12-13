// src/core/bot.ts

import { Bot, session } from "grammy";
import { BOT_TOKEN } from "./config";
import { supabase } from "./supabase";
import { MyContext, SessionData, Services } from "./types";

import { registerSecurityFeature } from "../features/security/guard";
import { registerOnboardingFeature } from "../features/world/onboarding";
import { registerTravelFeature } from "../features/world/travel";
import { registerUiFeature } from "../features/ui/ui";
import { registerFluxBuilderFeature } from "../features/worldbuilder/flux-builder";
import { registerVehicleTravelFeature } from "../features/world/travel-vehicles";
import { registerWorldAdminFeature } from "../features/worldbuilder/admin-builder";
import { registerWorldAdminCommands } from "../features/worldbuilder/admin-commands";
import { registerPathBuilderFeature } from "../features/worldbuilder/path-builder";
import { makeSupabaseDb } from "./db/adapters/supabase-db";
import { registerFuelAdminFeature } from "../features/economy/fuel-admin";
import { registerWorldVehicleShop } from "../features/economy/vehicle-shop";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required");
}

// این همونیه که src/index.ts ازش استفاده می‌کنه
export const bot = new Bot<MyContext>(BOT_TOKEN);

// سشن – یک آبجکت خالی که به SessionData کست می‌شه
bot.use(
  session({
    initial: () => ({} as SessionData),
  })
);

// ✅ یک‌بار برای همیشه سرویس‌ها را بساز
const services: Services = {
  supabase,
  db: makeSupabaseDb(supabase),
};

// ✅ تزریق سرویس‌ها به ctx
bot.use(async (ctx, next) => {
  ctx.services = services;
  return next();
});

// ===== رجیستر تمام فیچرها =====

registerSecurityFeature(bot);
registerWorldAdminCommands(bot);
registerVehicleTravelFeature(bot);
registerPathBuilderFeature(bot);
registerOnboardingFeature(bot);
registerWorldAdminFeature(bot);
registerWorldVehicleShop(bot);
registerTravelFeature(bot);
registerUiFeature(bot);
registerFluxBuilderFeature(bot);
registerFuelAdminFeature(bot);

// /start ساده برای راهنمای اولیه
bot.command("start", async (ctx) => {
  if (ctx.chat?.type !== "private") return;

  await ctx.reply(
    "به اکلیس خوش آمدی.\n" + "برای دیدن منوی اصلی بعداً می‌تونی از /menu استفاده کنی."
  );
});
