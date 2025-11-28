// src/core/bot.ts
import { Bot, Context, session, SessionFlavor, Keyboard } from "grammy";
import { BOT_TOKEN, BOT_OWNER_ID } from "./config.js";
import type { SessionData, MovementMode } from "./types.js";

export type EclisContext = Context & SessionFlavor<SessionData>;

export const bot = new Bot<EclisContext>(BOT_TOKEN);

bot.use(
  session({
    initial: (): SessionData => ({
      movementMode: "walk",
      __lastPmMessageId: null,
      worldBuilderMode: "idle",
      worldBuilderPayload: null,
      worldBuilderRegionId: null,
      worldBuilderRegionChatId: null,
      worldBuilderRegionTitle: null,
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

  try {
    if (ctx.chat?.type === "private" && ctx.session.__lastPmMessageId) {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.session.__lastPmMessageId);
    }
  } catch {
    // اشکالی ندارد
  }

  const msg = await ctx.reply(
    "✨ به پنل سفر اکلیس خوش آمدی.\n\nیک گزینه را انتخاب کن:",
    { reply_markup: kb },
  );

  if (ctx.chat?.type === "private") {
    ctx.session.__lastPmMessageId = msg.message_id;
  }
}

// تغییر حالت حرکت (فعلاً فقط روی سرعت و فیلتر مسیر تأثیر دارد)
export async function setMovementMode(
  ctx: EclisContext,
  mode: MovementMode,
) {
  ctx.session.movementMode = mode;
  let text: string;

  if (mode === "walk") {
    text =
      "🚶 حالت پیاده فعال شد.\nحرکتت آرام‌تره، ولی تقریباً همه‌جا می‌تونی بری.";
  } else if (mode === "ride") {
    text =
      "🐎 حالت سوارکار فعال شد.\nبعداً وقتی مانت و سیستم حیوون‌ها رو وصل کنیم، این حالت واقعی‌تر میشه.";
  } else if (mode === "drive") {
    text =
      "🚗 حالت راننده فعال شد.\nماشین و موتور وقتی اضافه شن، از این حالت استفاده می‌کنیم.";
  } else {
    text =
      "🎈 حالت حمل‌ونقل فعال شد.\nفقط خطوط ویژه‌ی قطار/بالن و… رو می‌بینی.";
  }

  await ctx.reply(text);
}

// ارباب بودن
export function isOwner(ctx: EclisContext): boolean {
  return ctx.from?.id === BOT_OWNER_ID;
}

export async function rejectNonOwner(ctx: EclisContext) {
  await ctx.reply("فقط اربابم می‌تونه بهم دستور بده، حدّتو بدون. 🐾");
}
