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
import { registerWorldVehicleShop } from "../features/economy/vehicle-shop";
// 👇 اگر ui.ts درست کرده‌ای، بعداً اینو برمی‌گردونیم
// import { registerUiFeature } from "../features/ui/ui";

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

// تزریق سرویس‌ها (فعلاً فقط supabase)
bot.use((ctx, next) => {
  ctx.services = { supabase } as Services;
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
services.db = makeSupabaseDb(services.supabase);


// /start ساده برای راهنمای اولیه
bot.command("start", async (ctx) => {
  if (ctx.chat?.type !== "private") return;

  await ctx.reply(
    "به اکلیس خوش آمدی.\n" +
      "برای دیدن منوی اصلی بعداً می‌تونی از /menu استفاده کنی."
  );
});
