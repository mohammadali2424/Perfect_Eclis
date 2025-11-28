import { Bot, session, InlineKeyboard, Keyboard } from "grammy";
import { BOT_TOKEN, MASTER_ID } from "./config";
import { supabase } from "./supabase";
import { MyContext, SessionData, Services } from "./types";
import { registerSecurityFeature } from "../features/security/guard";
import { registerTravelFeature } from "../features/world/travel";
import { registerWorldAdminFeature } from "../features/world/admin-builder";
import { registerRegistrationFeature } from "../features/registration";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required");
}

export const bot = new Bot<MyContext>(BOT_TOKEN);

const services: Services = {
  supabase,
  masterId: MASTER_ID,
};

bot.use(async (ctx, next) => {
  ctx.services = services;
  await next();
});

function initialSession(): SessionData {
  return {};
}
bot.use(session({ initial: initialSession }));

registerSecurityFeature(bot);
registerRegistrationFeature(bot); // ثبت‌نام قبل از ادمین/مسیر
registerTravelFeature(bot);
registerWorldAdminFeature(bot);

bot.command("start", async (ctx) => {
  const kb = new Keyboard()
    .text("🧭 مسیر های من")
    .resized(); // کیبورد رو جمع‌وجور می‌کنه

  await ctx.reply(
    "به Pathweaver خوش اومدی.\n" +
      "من مسیریاب جهان اکلیس‌ام.\n\n" +
      "از دکمه‌ی «🧭 مسیر های من» برای دیدن مقصدهای قابل دسترس استفاده کن.",
    { reply_markup: kb }
  );
});


