import { Bot, session, Keyboard } from "grammy";
import { BOT_TOKEN, MASTER_ID } from "./config";
import { supabase } from "./supabase";
import { MyContext, SessionData, Services } from "./types";

import { registerSecurityFeature } from "../features/security/guard";
import { registerTravelFeature } from "../features/world/travel";
import { registerWorldAdminFeature } from "../features/world/admin-builder";
import { registerRegistrationFeature } from "../features/registration";
import { registerOnboardingFeature } from "../features/world/onboarding";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required");
}

// خود بات
export const bot = new Bot<MyContext>(BOT_TOKEN);

// فقط برای اینکه مطمئن باشیم مقدار گرفته
console.log("[config] MASTER_ID =", MASTER_ID);

// سشن
bot.use(
  session({
    initial(): SessionData {
      return {} as SessionData;
    },
  })
);

// سرویس‌ها (supabase و غیره)
bot.use((ctx, next) => {
  ctx.services = {
    supabase,
  } as Services;
  return next();
});

// یک دستور تست برای اینکه ببینیم این فایل واقعا لود شده
bot.command("debug_alive", async (ctx) => {
  await ctx.reply("✅ Core bot زنده است و bot.ts جدید لود شده.");
});

// /start و کیبورد اصلی توی PV
bot.command("start", async (ctx) => {
  if (ctx.chat.type !== "private") return;

  const kb = new Keyboard()
    .text("🧭 مسیر های من")
    .row()
    .text("🗺 نقشه سریع من")
    .row()
    .text("ثبت من")
    .resized();

  await ctx.reply(
    "به Pathweaver خوش اومدی.\n" +
      "من مسیریاب جهان اکلیس‌ام.\n\n" +
      "برای ثبت‌نام از دکمه‌ی «ثبت من» استفاده کن.\n" +
      "بعد از تأیید ارباب، مسیرها برات باز می‌شن.",
    { reply_markup: kb }
  );
});

// اینجا تمام فیچرها رو به بات وصل می‌کنیم
registerSecurityFeature(bot);
registerOnboardingFeature(bot);
registerWorldAdminFeature(bot);
registerTravelFeature(bot);
registerRegistrationFeature(bot);
