import { Context } from "grammy";

export async function checkMaster(ctx: Context, next: Function) {
  const masterId = 123456789; // آیدی تو
  if (ctx.from?.id !== masterId) {
    return ctx.reply("فقط اربابم می‌تونه این دستور رو بده.");
  }
  return next();
}
