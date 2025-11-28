import { Bot, session } from "grammy";
import { createClient } from "@supabase/supabase-js";
import type { MyContext, SessionData } from "./types";

import { registerWorldAdminFeature } from "../features/world/admin-builder";
import { registerTravelFeature } from "../features/world/travel";
import { registerOnboardingFeature } from "../features/world/onboarding";

// توکن بات از env
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set in environment variables");
}

// تنظیم Supabase از env
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("SUPABASE_URL or SUPABASE_KEY is missing in env");
}

// کلاینت Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// سشن اولیه همیشه یه آبجکت خالیه
function initialSession(): SessionData {
  return {};
}

// ساخت بات با تایپ MyContext
export function createBot(): Bot<MyContext> {
  const bot = new Bot<MyContext>(BOT_TOKEN);

  // سشن in-memory (کافیه برای ربات تو)
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

  // ثبت فیچرها
  registerOnboardingFeature(bot);
  registerWorldAdminFeature(bot);
  registerTravelFeature(bot);

  return bot;
}
