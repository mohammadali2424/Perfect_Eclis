import type { EclisContext } from "../../core/bot.js";
import { showMainMenu, setMovementMode } from "../../core/bot.js";
import { handleMyPaths } from "./travel.js";

export async function handleStart(ctx: EclisContext) {
  if (ctx.chat?.type !== "private") {
    return ctx.reply("برای استفاده از منو، اول در پی‌وی من را /start بزن.");
  }

  await ctx.reply(
    "🌙 به جهان Eclis خوش آمدی.\n" +
      "اینجا هر شخصیت یک زندگی دوم دارد.\n\n" +
      "از منوی زیر برای مدیریت سفر، حالت حرکت و مسیرها استفاده کن.",
  );

  await showMainMenu(ctx);
}

// هندل پیام‌های متنی منوی اصلی
export async function handleMainMenuText(ctx: EclisContext) {
  const text = ctx.message?.text;
  if (!text) return;

  if (text === "🧭 مسیرهای من") {
    return handleMyPaths(ctx);
  }

  if (text === "🗺 نقشهٔ سریع من") {
    return ctx.reply(
      "فعلاً فقط لوکیشن متنی فعال است؛ بعداً نقشهٔ فانتزی هم اضافه می‌کنیم.",
    );
  }

  if (text === "🚶 حالت پیاده") {
    return setMovementMode(ctx, "walk");
  }

  if (text === "🐎 حالت سوارکار") {
    return setMovementMode(ctx, "ride");
  }

  if (text === "🚗 حالت راننده") {
    return setMovementMode(ctx, "drive");
  }

  if (text === "🎈 حمل و نقل") {
    return setMovementMode(ctx, "transport");
  }
}
