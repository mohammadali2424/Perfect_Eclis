// src/core/bot.ts

import { Bot, session } from "grammy";
import { BOT_TOKEN } from "./config";
import { supabase } from "./supabase";
import { MyContext, SessionData, Services } from "./types";

import { registerSecurityFeature } from "../features/security/guard";
import { registerOnboardingFeature } from "../features/world/onboarding";
import { registerTravelFeature } from "../features/world/travel";
import { registerVehicleTravelFeature } from "../features/world/travel-vehicles";
import { registerWorldAdminFeature } from "../features/world/admin-builder";
import { registerWorldAdminCommands } from "../features/world/admin-commands";
import { registerPathBuilderFeature } from "../features/world/path-builder";
import { registerWorldVehicleShop } from "../features/world/vehicle-shop";
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

// گارد امنیتی و لفت از گروه‌های ناخواسته
registerSecurityFeature(bot);

// دستورات جهان‌ساز ساده (مثل /worldadmin و …)
registerWorldAdminCommands(bot);

// ماژول سفر با وسیله نقلیه (ماشین، سوخت، …)
registerVehicleTravelFeature(bot);

// ماژول ساخت مسیرها (path-builder)
registerPathBuilderFeature(bot);

// ثبت‌نام و انتخاب خاندان در PV
registerOnboardingFeature(bot);

// پنل جهان‌ساز (Region / Spot / Edge و …)
registerWorldAdminFeature(bot);

// ماژول فروشگاه وسیله (ثبت ماشین برای پلیرها)
registerWorldVehicleShop(bot);

// سفر پیاده / مسیر های من / نقشه سریع من
registerTravelFeature(bot);

// UI مرکزی اگر داشتی، بعداً فعالش می‌کنیم
// registerUiFeature(bot);

// /start ساده برای راهنمای اولیه
bot.command("start", async (ctx) => {
  if (ctx.chat?.type !== "private") return;

  await ctx.reply(
    "به اکلیس خوش آمدی.\n" +
      "برای دیدن منوی اصلی بعداً می‌تونی از /menu استفاده کنی."
  );
});
