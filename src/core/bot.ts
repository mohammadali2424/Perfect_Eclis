import { Bot } from "grammy";
import { config } from "./config";
import { onboardingMenu } from "../features/world/onboarding";
import { registerPlayer } from "../features/registration/registration";
import { checkMaster } from "../features/security/guard";

export function runBot() {
  const bot = new Bot(config.BOT_TOKEN);

  bot.command("start", (ctx) => onboardingMenu(ctx));

  bot.command("register", (ctx) => registerPlayer(ctx));

  bot.command("worldadmin", checkMaster, async (ctx) => {
    await ctx.reply("پنل مدیریت جهان آماده است.");
  });

  bot.catch((err) => console.error("Bot Error:", err));

  console.log("Bot running…");

  bot.start();
}
