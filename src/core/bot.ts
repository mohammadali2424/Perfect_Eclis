// src/core/bot.ts

import { Bot, session } from "grammy";
import { BOT_TOKEN } from "./config";
import { supabase } from "./supabase";
import { MyContext, SessionData, Services } from "./types";

import { registerWorldAdminCommands } from "../features/world/admin-commands";
import { registerSecurityFeature } from "../features/security/guard";
import { registerTravelFeature } from "../features/world/travel";
import { registerUiFeature } from "../features/ui/ui";
import { registerPathBuilderFeature } from "../features/world/path-builder";
import { registerVehicleTravelFeature } from "../features/world/travel-vehicles";
import { registerWorldVehicleShop } from "../features/world/vehicle-shop";
import { registerWorldAdminFeature } from "../features/world/admin-builder";
import { registerOnboardingFeature } from "../features/world/onboarding";

// UI مرکزی که قبلاً با هم ساختیم
import { registerUiFeature } from "../features/ui/ui";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required");
}

// یک بات سراسری که index.ts از آن استفاده می‌کند
export const bot = new Bot<MyContext>(BOT_TOKEN);

// سشن – ساده: یک آبجکت خالی که به SessionData کست می‌شود
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

// رجیستر تمام فیچرها
registerSecurityFeature(bot);
registerWorldAdminCommands(bot);
registerVehicleTravelFeature(bot);
registerPathBuilderFeature(bot);
registerOnboardingFeature(bot);
registerWorldAdminFeature(bot);
registerUiFeature(bot);
registerWorldVehicleShop(bot);
registerTravelFeature(bot);

// در پایان: UI منوی اصلی و پاک‌کردن پیام‌های پی‌وی
registerUiFeature(bot);

// می‌تونی برای راحتی یک /start ساده هم بگذاری
bot.command("start", async (ctx) => {
  if (ctx.chat?.type !== "private") return;

  await ctx.reply(
    "به اکلیس خوش آمدی.\n" +
      "برای دیدن منوی اصلی از /menu استفاده کن یا بنویس «نقشه اکلیس»."
  );
});
// src/core/bot.ts

import { Bot, session } from "grammy";
import type { SessionFlavor } from "grammy";
import { MyContext, SessionData, Services } from "./types";
