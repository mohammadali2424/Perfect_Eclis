import { Bot, session } from "grammy";
import { createClient } from "@supabase/supabase-js";
import type { MyContext, SessionData } from "./types";

import { registerWorldAdminFeature } from "../features/world/admin-builder";
import { registerTravelFeature } from "../features/world/travel";
import { registerOnboardingFeature } from "../features/world/onboarding";

/**
 * کمک‌کننده برای گرفتن env اجباری
 * اگر ست نشده باشد، هم در runtime خطا می‌ده و هم برای TS روشن است که خروجی string است.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  return value;
}

// توکن بات از env
const BOT_TOKEN: string = requireEnv("BOT_TOKEN");

// تنظیم Supabase از env
const SUPABASE_URL: string = requireEnv("SUPABASE_URL");
const SUPABASE_KEY: string = (() => {
  const direct = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!direct) {
    throw new Error(
      "Either SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY must be set in env"
    );
  }
  return direct;
})();

// کلاینت Supabase – حالا هر دو پارامتر به‌طور قطعی string هستند
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// سشن اولیه همیشه یه آبجکت خالیه
function initialSession(): SessionData {
  return {};
}

// ساخت بات با تایپ MyContext
export function createBot(): Bot<MyContext> {
  const bot = new Bot<MyContext>(BOT_TOKEN);

  // سشن in-memory
  bot.use(
    session({
      initial: initialSession,
    })
  );

  // تزریق supabase به ctx.services
  bot.use(async (ctx, next) => {
    (ctx as any).services = { supabase };
    await next();
  });

  // ثبت فیچرهای جهان اکلیس
  registerOnboardingFeature(bot);
  registerWorldAdminFeature(bot);
  registerTravelFeature(bot);

  return bot;
}
