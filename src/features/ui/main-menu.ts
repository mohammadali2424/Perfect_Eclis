
import { Bot, Keyboard } from "grammy";
import { MyContext } from "../../core/types";

export function registerMainMenuFeature(bot: Bot<MyContext>) {
  const mainKb = new Keyboard()
    .text("🧭 مسیرهای من")
    .text("📍 نقشه سریع من")
    .row()
    .resized();

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "به اکلیس خوش آمدی.\nاز منو یکی از گزینه‌ها را انتخاب کن.",
      { reply_markup: mainKb }
    );
  });

  bot.hears("🧭 مسیرهای من", async (ctx) => {
    await ctx.conversation?.exit?.();
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");
    await ctx.api.sendMessage(
      ctx.chat!.id,
      "در حال بررسی مسیرهای قابل سفر هستم...",
    );
    await ctx.api.sendMessage(ctx.chat!.id, "/path");
  });

  bot.hears("📍 نقشه سریع من", async (ctx) => {
    const { supabase } = ctx.services;
    if (!ctx.from) return;

    const { data: ch } = await supabase
      .from("characters")
      .select(
        "id,char_name,current_region_id,current_spot_id,regions(title),spots(title)",
      )
      .eq("tg_id", ctx.from.id)
      .maybeSingle();

    if (!ch) {
      await ctx.reply(
        "شخصیتت هنوز در جهان ثبت نشده. از ارباب بخواه با /regplayer تو را ثبت کند.",
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
        "این همان جایی‌ست که اکنون بر روی سنگفرش‌هایش قدم می‌زنی.",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  });
}
