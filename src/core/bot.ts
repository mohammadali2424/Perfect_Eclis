import { Bot, Context, session, SessionFlavor, InlineKeyboard, Keyboard } from "grammy";
import { BOT_TOKEN, BOT_OWNER_ID } from "./config.js";
import type { SessionData } from "./types.js";

export type EclisContext = Context & SessionFlavor<SessionData>;

export const bot = new Bot<EclisContext>(BOT_TOKEN);

bot.use(session({
  initial: (): SessionData => ({
    movementMode: "walk",
    __lastPmMessageId: null,
  })
}));

// منوی اصلی پی‌وی
export async function showMainMenu(ctx: EclisContext) {
  const kb = new Keyboard()
    .text("🧭 مسیرهای من").row()
    .text("🗺 نقشهٔ سریع من").row()
    .text("🚶 حالت پیاده").text("🐎 حالت سوارکار").row()
    .text("🚗 حالت راننده").text("🎈 حمل و نقل").resized();

  // پاک کردن پیام قبلی منو اگر بود
  try {
    if (ctx.session.__lastPmMessageId && ctx.chat?.type === "private") {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.session.__lastPmMessageId);
    }
  } catch (_) {
    // نادیده بگیر
  }

  const msg = await ctx.reply(
    "✨ به پنل سفر اکلیس خوش آمدی.

یک گزینه را انتخاب کن:",
    { reply_markup: kb }
  );

  if (ctx.chat?.type === "private") {
    ctx.session.__lastPmMessageId = msg.message_id;
  }
}

// تغییر حالت حرکت
export async function setMovementMode(ctx: EclisContext, mode: SessionData["movementMode"]) {
  ctx.session.movementMode = mode;
  let txt = "";
  switch (mode) {
    case "walk":
      txt = "🚶 حالت پیاده فعال شد.
حرکتت آرام‌تره، اما به بیشتر مسیرها دسترسی داری.";
      break;
    case "ride":
      txt = "🐎 حالت سوارکار فعال شد.
اگر مانت همراهت باشه می‌تونی سریع‌تر و فانتزی‌تر سفر کنی.";
      break;
    case "drive":
      txt = "🚗 حالت راننده فعال شد.
اگر وسیله‌ات در همین لوکیشن باشه، جاده‌ها در اختیارتن.";
      break;
    case "transport":
      txt = "🎈 حالت حمل و نقل فعال شد.
از این به بعد فقط خطوط ویژه قطار، بالن و … را می‌بینی.";
      break;
  }
  await ctx.reply(txt);
}

// گارد ارباب ربات
export function isOwner(ctx: EclisContext): boolean {
  return ctx.from?.id === BOT_OWNER_ID;
}

// پیام پیش‌فرض برای کسی که می‌خواد به ربات دستور بده
export async function rejectNonOwner(ctx: EclisContext) {
  await ctx.reply("فقط اربابم می‌تونه بهم دستور بده، حدّتو بدون. 🐾");
}
