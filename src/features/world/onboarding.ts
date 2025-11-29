import { Context } from "grammy";

export async function onboardingMenu(ctx: Context) {
  await ctx.reply("به اکلیس خوش آمدی. برای شروع یکی از گزینه‌های زیر را بزن:");
}
