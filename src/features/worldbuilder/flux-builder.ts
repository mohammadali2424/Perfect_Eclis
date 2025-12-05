import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

export function registerFluxBuilderFeature(bot: Bot<MyContext>): void {
  // دستور: «ساخت چاه فلوکس» در گروه Region
  bot.hears("ساخت چاه فلوکس", async (ctx) => {
    if (!ctx.from) return;

    // فقط ارباب
    if (ctx.from.id !== MASTER_ID) {
      await ctx.reply("🥷🏻 فقط ارباب من میتونه چاه فلوکس بسازه، حدت رو بدون.");
      return;
    }

    if (ctx.chat.type === "private") {
      await ctx.reply("این دستور را باید داخل یک گروه Region بفرستی.");
      return;
    }

    const { supabase } = ctx.services;

    // سعی کن پیام دستور در گروه پاک شود (تا تمیز بماند)
    try {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.message!.message_id);
    } catch {
      // مهم نیست اگر نتواند
    }

    // Region را بر اساس chat_id این گروه پیدا کن
    const { data: region, error: regErr } = await supabase
      .from("regions")
      .select("id, title")
      .eq("telegram_chat_id", ctx.chat.id)
      .maybeSingle();

    if (regErr || !region) {
      await ctx.api.sendMessage(
        ctx.from.id,
        "این گروه هنوز به عنوان Region ثبت نشده.\n" +
          "اول باید این گروه را به عنوان Region بسازی (مثلاً با /worldadmin)."
      );
      return;
    }

    // Spots مربوط به این Region
    const { data: spots, error: spotErr } = await supabase
      .from("spots")
      .select("id, title, is_flux_spot")
      .eq("region_id", region.id)
      .order("id", { ascending: true });

    if (spotErr) {
      await ctx.api.sendMessage(
        ctx.from.id,
        "در خواندن Spotهای این Region مشکلی پیش آمد."
      );
      return;
    }

    if (!spots || spots.length === 0) {
      await ctx.api.sendMessage(
        ctx.from.id,
        `برای Region «${region.title}» هنوز هیچ Spotی ثبت نشده.\n` +
          "اول چند Spot برای این Region بساز، بعد دوباره «ساخت چاه فلوکس» را بفرست."
      );
      return;
    }

    const kb = new InlineKeyboard();
    for (const s of spots) {
      const mark = s.is_flux_spot ? "⛽" : "⚪";
      kb.text(`${mark} ${s.title}`, `flux:set:${s.id}`).row();
    }

    await ctx.api.sendMessage(
      ctx.from.id,
      `برای Region «${region.title}» کدام Spot تبدیل به چاه فلوکس شود؟\n` +
        "Spot مورد نظر را انتخاب کن (⛽ یعنی همین حالا هم چاه فلوکس دارد):",
      { reply_markup: kb }
    );
  });

  // کلیک روی انتخاب Spot برای فلوکس
  bot.callbackQuery(/flux:set:(\d+)/, async (ctx) => {
    if (!ctx.from) return;
    if (ctx.from.id !== MASTER_ID) {
      await ctx.answerCallbackQuery({
        text: "فقط ارباب می‌تواند چاه فلوکس را تنظیم کند.",
        show_alert: true,
      });
      return;
    }

    const spotId = Number(ctx.match![1]);
    const { supabase } = ctx.services;

    const { data: spot, error: spotErr } = await supabase
      .from("spots")
      .select("id, title, is_flux_spot")
      .eq("id", spotId)
      .maybeSingle();

    if (spotErr || !spot) {
      await ctx.answerCallbackQuery({
        text: "این Spot پیدا نشد.",
        show_alert: true,
      });
      return;
    }

    const newVal = !spot.is_flux_spot;

    const { error: updErr } = await supabase
      .from("spots")
      .update({ is_flux_spot: newVal })
      .eq("id", spot.id);

    if (updErr) {
      console.error("update flux spot error:", updErr);
      await ctx.answerCallbackQuery({
        text: "در به‌روزرسانی چاه فلوکس مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({
      text: newVal
        ? `✅ «${spot.title}» حالا چاه فلوکس دارد.`
        : `⛔ چاه فلوکس از «${spot.title}» برداشته شد.`,
      show_alert: true,
    });
  });
}
