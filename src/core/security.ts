// src/core/security.ts
import { MASTER_ID } from "./config";
import { MyContext } from "./types";

export function isMaster(ctx: MyContext): boolean {
  return !!ctx.from && ctx.from.id === MASTER_ID;
}

/**
 * گارد سبک: این handler را فقط در پیوی ادامه بده.
 * نکته: این یک util است؛ تا زمانی که خودت صداش نزنی رفتاری را تغییر نمی‌دهد.
 */
export async function requirePrivate(ctx: MyContext): Promise<boolean> {
  if (ctx.chat?.type === "private") return true;
  await ctx.reply("این بخش فقط در پیوی قابل استفاده است.");
  return false;
}

/**
 * گارد سبک: فقط مستر.
 */
export async function requireMaster(ctx: MyContext): Promise<boolean> {
  if (isMaster(ctx)) return true;
  await ctx.reply("🥷🏻 فقط ارباب من می‌تونه این دستور رو استفاده کنه.");
  return false;
}
