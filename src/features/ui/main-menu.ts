// src/features/ui/main-menu.ts
import { Bot, Keyboard } from "grammy";
import { MyContext } from "../../core/types";

export function registerMainMenuFeature(bot: Bot<MyContext>) {
  const mainKeyboard = new Keyboard()
    .text("🧭 مسیر های من").text("🗺 نقشه سریع من")
    .row()
    // اگر خواستی بعداً دکمه‌های دیگه اضافه کن:
    // .text("🏛 منوی اصلی").row()
    .resized();

  async function sendMainMenu(ctx: MyContext, extra?: string) {
    const text =
      extra ||
      "درهای اکلیس رو به‌رویت باز شد.\n" +
        "از دکمه‌های زیر یکی را انتخاب کن.";
    await ctx.reply(text, { reply_markup: mainKeyboard });
  }

  // استارت ربات: برای همه‌ی یوزرها کیبورد رو می‌فرسته
  bot.command("start", async (ctx) => {
    await sendMainMenu(ctx);
  });

  // اگر خواستی دکمه «🏛 منوی اصلی» هم بعداً اضافه کنی،
  // این هندلرش آماده است، فقط دکمه‌اش رو به mainKeyboard اضافه کن.
  bot.hears("🏛 منوی اصلی", async (ctx) => {
    await sendMainMenu(ctx, "منوی اصلی اکلیس دوباره جلوی چشمت ظاهر شد.");
  });
}
