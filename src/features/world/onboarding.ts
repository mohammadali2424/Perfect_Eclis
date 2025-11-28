import type { EclisContext } from "../../core/bot.js";
import { showMainMenu, setMovementMode } from "../../core/bot.js";

export async function handleStart(ctx: EclisContext) {
  if (ctx.chat?.type !== "private") {
    return ctx.reply("برای استفاده از منو، ابتدا در پی‌وی من را /start کن.");
  }

  await ctx.reply(
    "🌙 به جهان Eclis خوش آمدی.
" +
      "اینجا هر شخصیت یک زندگی دوم دارد.

" +
      "از منوی زیر برای مدیریت سفر، حالت حرکت و مسیرها استفاده کن."
  );

  await showMainMenu(ctx);
}

// هندلر دکمه‌های کیبورد Reply
export async function handleMainMenuText(ctx: EclisContext) {
  const text = ctx.message?.text;
  if (!text) return;

  if (text === "🧭 مسیرهای من") {
    // در نسخه فعلی، Travel فقط نمایش متنی دارد
    const { handleMyPaths } = await import("./travel.js");
    return handleMyPaths(ctx);
  }

  if (text === "🗺 نقشهٔ سریع من") {
    return ctx.reply("در نسخه بعدی، نقشهٔ سریع لوکیشن فعلی و ریجن برایت نمایش داده می‌شود.");
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
