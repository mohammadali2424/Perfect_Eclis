import { Bot, session } from "grammy";
import { BOT_TOKEN, MASTER_ID } from "./config";
import { supabase } from "./supabase";
import { MyContext, SessionData, Services } from "./types";
import { registerSecurityFeature } from "../features/security/guard";
import { registerTravelFeature } from "../features/world/travel";
import { registerWorldAdminFeature } from "../features/world/admin-builder";

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
registerTravelFeature(bot);
registerWorldAdminFeature(bot);

// تست ساده
bot.command("ping", async (ctx) => {
  await ctx.reply("pong");
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "به Pathweaver خوش اومدی.\n" +
      "من نقشه‌گرد جهان اکلیس هستم.\n" +
      "برای دیدن مسیر فعلی: /path\n" +
      "برای رسیدن به مقصد بعد از سفر: /arrive"
  );
});
