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
