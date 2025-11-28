// src/features/ui/main-menu.ts
import { Bot, Keyboard } from "grammy";
import { MyContext } from "../../core/types";

export function registerMainMenuFeature(bot: Bot<MyContext>) {
  const mainKb = new Keyboard()
    .text("🧭 مسیرهای من")
    .text("📍 نقشه سریع من")
    .row()
    .resized();

  // /start → نشون‌دادن منوی اصلی
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "به اکلیس خوش آمدی.\nاز منو یکی از گزینه‌ها را انتخاب کن.",
      { reply_markup: mainKb }
    );
  });

  // دکمه‌ی «مسیرهای من»
  bot.hears("🧭 مسیرهای من", async (ctx) => {
    await ctx.reply(
      "برای دیدن مسیرهای قابل سفر، دستور /path را بفرست.\n(به‌زودی این گزینه مستقیماً لیست مسیرها را باز می‌کند.)"
    );
  });

  // دکمه‌ی «نقشه سریع من»
  bot.hears("📍 نقشه سریع من", async (ctx) => {
    const { supabase } = ctx.services;
    if (!ctx.from) return;

    const { data: ch } = await supabase
      .from("characters")
      .select(
        "id,char_name,current_region_id,current_spot_id,regions(title),spots(title)"
      )
      .eq("tg_id", ctx.from.id)
      .maybeSingle();

    if (!ch) {
      await ctx.reply(
        "شخصیتت هنوز در جهان ثبت نشده. از ارباب بخواه با /regplayer تو را ثبت کند."
      );
      return;
    }

    const regionTitle =
      (ch as any).regions?.title ?? "ناحیه‌ای ناشناخته در مه";
    const spotTitle =
      (ch as any).spots?.title ?? "نقطه‌ای بی‌نام روی نقشه";

    await ctx.reply(
      [
        "🧭 نقشه سریع تو:",
        "",
        `منطقه: <b>${regionTitle}</b>`,
        `مکان فعلی: <b>${spotTitle}</b>`,
        "",
        "اینجا همان جایی‌ست که اکنون روی سنگفرش‌هایش ایستاده‌ای.",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  });
}
