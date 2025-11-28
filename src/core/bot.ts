import { Bot, Context, session, SessionFlavor, Keyboard } from "grammy";
import { BOT_TOKEN, BOT_OWNER_ID } from "./config.js";
import type { SessionData } from "./types.js";

export type EclisContext = Context & SessionFlavor<SessionData>;

export const bot = new Bot<EclisContext>(BOT_TOKEN);

bot.use(
  session({
    initial: (): SessionData => ({
      movementMode: "walk",
      __lastPmMessageId: null,
      worldBuilderMode: undefined,
      worldBuilderPayload: undefined,
      travelEdgeId: null,
      travelStartAt: null,
      travelEta: null,
    }),
  }),
);

// منوی اصلی پی‌وی
export async function showMainMenu(ctx: EclisContext) {
  const kb = new Keyboard()
    .text("🧭 مسیرهای من")
    .row()
    .text("🗺 نقشهٔ سریع من")
    .row()
    .text("🚶 حالت پیاده")
    .text("🐎 حالت سوارکار")
    .row()
    .text("🚗 حالت راننده")
    .text("🎈 حمل و نقل")
    .resized();

  // پاک کردن منوی قبلی اگر هست
  try {
    if (ctx.chat?.type === "private" && ctx.session.__lastPmMessageId) {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.session.__lastPmMessageId);
    }
  } catch {
    // مهم نیست، رد شو
  }

  const msg = await ctx.reply(
    "✨ به پنل سفر اکلیس خوش آمدی.\n\nیک گزینه را انتخاب کن:",
    { reply_markup: kb },
  );

  if (ctx.chat?.type === "private") {
    ctx.session.__lastPmMessageId = msg.message_id;
  }
}

// تغییر حالت حرکت
export async function setMovementMode(
  ctx: EclisContext,
  mode: SessionData["movementMode"],
) {
  ctx.session.movementMode = mode;
  let text: string;

  if (mode === "walk") {
    text =
      "🚶 حالت پیاده فعال شد.\nحرکتت آرام‌تره، ولی به بیشتر مسیرها دسترسی داری.";
  } else if (mode === "ride") {
    text =
      "🐎 حالت سوارکار فعال شد.\nاگر مانت همراهت باشد، سفرها سریع‌تر و فانتزی‌تر می‌شوند.";
  } else if (mode === "drive") {
    text =
      "🚗 حالت راننده فعال شد.\nاگر وسیله‌ات در همین لوکیشن باشد، جاده‌ها در اختیارتن.";
  } else {
    text =
      "🎈 حالت حمل و نقل فعال شد.\nفقط خطوط ویژه مثل قطار و بالن را می‌بینی.";
  }

  await ctx.reply(text);
}

// گارد ارباب ربات
export function isOwner(ctx: EclisContext): boolean {
  return ctx.from?.id === BOT_OWNER_ID;
}

// پیام پیش‌فرض برای کسی که می‌خواد به ربات دستور بده
export async function rejectNonOwner(ctx: EclisContext) {
  await ctx.reply("فقط اربابم می‌تونه بهم دستور بده، حدّتو بدون. 🐾");
}
