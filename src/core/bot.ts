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

// فقط برای اینکه TypeScript غر نزنه که MASTER_ID استفاده نشده
console.log("[config] MASTER_ID =", MASTER_ID);

// سشن
bot.use(
  session({
    initial(): SessionData {
      return {} as SessionData;
    },
  })
);

// تزریق سرویس‌ها (supabase و …)
bot.use((ctx, next) => {
  ctx.services = {
    supabase,
  } as Services;
  return next();
});

// /start و کیبورد PV
bot.command("start", async (ctx) => {
  if (ctx.chat.type !== "private") return;

  const kb = new Keyboard()
    .text("🧭 مسیر های من")
    .row()
    .text("🗺 نقشه سریع من")
    .resized();

  await ctx.reply(
    "به Pathweaver خوش اومدی.\n" +
      "من مسیریاب جهان اکلیس‌ام.\n\n" +
      "برای دیدن مسیر های فعالت از دکمه‌ی «🧭 مسیر های من» استفاده کن.\n" +
      "اول باید توسط ارباب تأیید و روی نقشه مستقر بشی.",
    { reply_markup: kb }
  );
});

// اینجا تمام فیچرها رو واقعا وصل می‌کنیم
registerSecurityFeature(bot);
registerOnboardingFeature(bot);
registerWorldAdminFeature(bot);
registerTravelFeature(bot);
registerRegistrationFeature(bot);
