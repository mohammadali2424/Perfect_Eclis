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
import { createSupabaseClient } from "./supabase";

// ===== فیچرها =====
import { registerSecurityFeature } from "../features/security/guard";
import { registerOnboardingFeature } from "../features/world/onboarding";
import { registerTravelFeature } from "../features/world/travel";
import { registerVehicleTravelFeature } from "../features/world/travel-vehicles";
import { registerVehicleShopFeature } from "../features/world/vehicle-shop";

import { registerWorldBuilderFeature } from "../features/worldbuilder/admin-builder";
// اگر path-builder و flux-builder داری، این‌ها رو باز کن:
import { registerPathBuilderFeature } from "../features/worldbuilder/path-builder";
import { registerFluxBuilderFeature } from "../features/worldbuilder/flux-builder";

import { registerUiFeature } from "../features/ui/ui";

// اگر قبلاً SessionData نداشتی، می‌تونی این initial رو
// با چیزی که خودت داشتی هماهنگ کنی
function initialSession(): SessionData {
  return {
    reg_step: null,
    reg_clan: null,
    reg_name: null,
    ui_last_message_id: undefined,
    // هر فیلد دیگه‌ای که در SessionData تعریف کرده‌ای
  } as SessionData;
}

export function createBot(token: string): Bot<MyContext> {
  const bot = new Bot<MyContext>(token);

  // ---------- Session ----------
  bot.use(
    session({
      initial: initialSession,
    })
  );

  // ---------- Services (Supabase و غیره) ----------
  const supabase = createSupabaseClient();

  bot.use(async (ctx, next) => {
    // این‌جا می‌تونی هر سرویس دیگری هم اضافه کنی
    (ctx as MyContext).services = {
      supabase,
    } as Services;

    return next();
  });

  // ---------- ثبت فیچرها ----------

  // امنیت و گارد
  registerSecurityFeature(bot);

  // ثبت‌نام و انتخاب خاندان
  registerOnboardingFeature(bot);

  // سفر پیاده / مسیرها / نقشه
  registerTravelFeature(bot);

  // سفر با وسایل نقلیه (ماشین، راننده، سوخت و ...)
  registerVehicleTravelFeature(bot);

  // فروشگاه وسایل نقلیه (ثبت وسیله، ادمین شاپ و ...)
  registerVehicleShopFeature(bot);

  // پنل جهان‌ساز (Region, Spot, Edge و ...)
  registerWorldBuilderFeature(bot);

  // ماژول ساخت مسیرها اگر جدا کرده‌ای
  registerPathBuilderFeature(bot);

  // چاه فلوکس و سیستم سوخت سراسری
  registerFluxBuilderFeature(bot);

  // UI مرکزی (منوی اصلی، پاک کردن پیام قبلی در پی‌وی، ...)
  registerUiFeature(bot);

  // یک /start ساده که کاربر را بفرستد سمت منوی اصلی
  bot.command("start", async (ctx) => {
    if (ctx.chat?.type !== "private") return;

    await ctx.reply(
      "به اکلیس خوش آمدی.\n" +
        "برای دیدن منوی اصلی، از /menu استفاده کن یا بنویس: «نقشه اکلیس»"
    );
  });

  return bot;
}
