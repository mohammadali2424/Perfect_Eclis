// src/core/bot.ts

import { Bot, session } from "grammy";
import { BOT_TOKEN } from "./config";
import { supabase } from "./supabase";
import { MyContext, SessionData, Services } from "./types";

import { registerWorldAdminCommands } from "../features/world/admin-commands";
import { registerSecurityFeature } from "../features/security/guard";
import { registerTravelFeature } from "../features/world/travel";
import { registerPathBuilderFeature } from "../features/world/path-builder";
import { registerVehicleTravelFeature } from "../features/world/travel-vehicles";
import { registerWorldVehicleShop } from "../features/world/vehicle-shop";
import { registerWorldAdminFeature } from "../features/world/admin-builder";
import { registerOnboardingFeature } from "../features/world/onboarding";

// اگر ui.ts را ساخته‌ای، این را نگه‌دار؛ اگر نه، موقتاً کامنت کن
import { registerUiFeature } from "../features/ui/ui";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required");
}

// این همانی است که index.ts انتظار دارد
export const bot = new Bot<MyContext>(BOT_TOKEN);

// سشن – ساده: SessionData خالی، بعداً پر می‌شود
bot.use(
  session({
    initial: () => ({} as SessionData),
  })
);

// تزریق سرویس‌ها (supabase و هرچیز دیگر بعداً)
bot.use((ctx, next) => {
  ctx.services = { supabase } as Services;
  return next();
});

// ===== رجیستر تمام فیچرها =====

// گارد امنیتی و لفت از گروه‌های ناخواسته
registerSecurityFeature(bot);

// دستورات جهان‌ساز ساده (مثل /worldadmin و غیره)
registerWorldAdminCommands(bot);

// سفر با وسیله نقلیه (رانندگی، سوخت، مسیر راننده و ...)
registerVehicleTravelFeature(bot);

// ساخت مسیرها (path-builder)
registerPathBuilderFeature(bot);

// ثبت‌نام و انتخاب خاندان
registerOnboardingFeature(bot);

// پنل ادمین جهان (Region, Spot, و... در سطح ادمین)
registerWorldAdminFeature(bot);

// فروشگاه وسیله نقلیه (ثبت ماشین/موتور برای پلیرها)
registerWorldVehicleShop(bot);

// سفر پیاده و منوی مسیرها / نقشه
registerTravelFeature(bot);

// UI مرکزی: منوی اصلی + پاک کردن پیام‌های قبلی پی‌وی
registerUiFeature(bot);

// /start ساده که کاربر را هدایت کند
bot.command("start", async (ctx) => {
  if (ctx.chat?.type !== "private") return;

  await ctx.reply(
    "به اکلیس خوش آمدی.\n" +
      "برای دیدن منوی اصلی از /menu استفاده کن یا بنویس «نقشه اکلیس»."
  );
});
