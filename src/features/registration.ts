import { Context } from "grammy";

export async function registerPlayer(ctx: Context) {
  await ctx.reply("⚡ ثبت‌نام شروع شد.\nاسم رول‌پلی خودتو وارد کن:");
}
