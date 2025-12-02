import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

function isMaster(ctx: MyContext) {
  return !!ctx.from && ctx.from.id === MASTER_ID;
}

function isGroup(ctx: MyContext) {
  return !!ctx.chat && ctx.chat.type !== "private";
}

export function registerFuelAdminFeature(bot: Bot<MyContext>): void {
  //
  // ساخت چاه فلوکس عادی
  //
  bot.hears("ساخت چاه فلوکس", async (ctx) => {
    if (!isGroup(ctx) || !isMaster(ctx)) return;

    const { supabase } = ctx.services;
    const chatId = ctx.chat!.id;

    const { data: region, error: regErr } = await supabase
      .from("regions")
      .select("id, title")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();

    if (regErr || !region) {
      await ctx.reply("این گروه هنوز به عنوان Region ثبت نشده. اول worldadmin/ساخت منطقه را انجام بده.");
      return;
    }

    const { data: spots, error: spotErr } = await supabase
      .from("spots")
      .select("id, title")
      .eq("region_id", region.id);

    if (spotErr || !spots || spots.length === 0) {
      await ctx.reply("برای این Region هنوز هیچ Spotی تعریف نشده.");
      return;
    }

    const kb = new InlineKeyboard();
    for (const s of spots) {
      kb.text(s.title, `flux:set:${s.id}:normal`).row();
    }

    await ctx.api.sendMessage(
      ctx.from!.id,
      `⛽ ساخت چاه فلوکس برای Region: ${region.title}\n` +
        "یکی از Spotها را انتخاب کن:",
      { reply_markup: kb }
    );

    await ctx.reply("لیست Spotها برای ساخت چاه فلوکس به پی‌وی‌ات ارسال شد.");
  });

  //
  // ساخت چاه اضطراری (ظرف فلوکس هم دارد)
  //
  bot.hears("ساخت چاه اضطراری فلوکس", async (ctx) => {
    if (!isGroup(ctx) || !isMaster(ctx)) return;

    const { supabase } = ctx.services;
    const chatId = ctx.chat!.id;

    const { data: region, error: regErr } = await supabase
      .from("regions")
      .select("id, title")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();

    if (regErr || !region) {
      await ctx.reply("این گروه هنوز به عنوان Region ثبت نشده.");
      return;
    }

    const { data: spots, error: spotErr } = await supabase
      .from("spots")
      .select("id, title")
      .eq("region_id", region.id);

    if (spotErr || !spots || spots.length === 0) {
      await ctx.reply("برای این Region هنوز Spot تعریف نشده.");
      return;
    }

    const kb = new InlineKeyboard();
    for (const s of spots) {
      kb.text(s.title, `flux:set:${s.id}:emergency`).row();
    }

    await ctx.api.sendMessage(
      ctx.from!.id,
      `🧪 ساخت چاه اضطراری فلوکس برای Region: ${region.title}\n` +
        "Spot مورد نظر را انتخاب کن:",
      { reply_markup: kb }
    );

    await ctx.reply("لیست Spotها برای ساخت چاه اضطراری به پی‌وی‌ات ارسال شد.");
  });

  //
  // حذف چاه فلوکس از یک Spot
  //
  bot.hears("حذف چاه فلوکس", async (ctx) => {
    if (!isGroup(ctx) || !isMaster(ctx)) return;

    const { supabase } = ctx.services;
    const chatId = ctx.chat!.id;

    const { data: region, error: regErr } = await supabase
      .from("regions")
      .select("id, title")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();

    if (regErr || !region) {
      await ctx.reply("این گروه هنوز به عنوان Region ثبت نشده.");
      return;
    }

    const { data: spots, error: spotErr } = await supabase
      .from("spots")
      .select("id, title, is_flux_station, has_emergency_flux")
      .eq("region_id", region.id)
      .eq("is_flux_station", true);

    if (spotErr || !spots || spots.length === 0) {
      await ctx.reply("در این Region هیچ چاه فلوکس فعالی نیست.");
      return;
    }

    const kb = new InlineKeyboard();
    for (const s of spots) {
      kb.text(s.title, `flux:clear:${s.id}`).row();
    }

    await ctx.api.sendMessage(
      ctx.from!.id,
      `❌ حذف چاه فلوکس در Region: ${region.title}\n` +
        "کدام چاه را می‌خواهی حذف کنی؟",
      { reply_markup: kb }
    );

    await ctx.reply("لیست چاه‌های فلوکس برای حذف، به پی‌وی‌ات ارسال شد.");
  });

  //
  // callback برای set / clear
  //
  bot.callbackQuery(/flux:(set|clear):(\d+):(normal|emergency)?/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }

    const action = ctx.match![1]; // set / clear
    const spotId = Number(ctx.match![2]);
    const mode = ctx.match![3];   // normal / emergency یا undefined

    const { supabase } = ctx.services;

    if (action === "clear") {
      const { error } = await supabase
        .from("spots")
        .update({ is_flux_station: false, has_emergency_flux: false })
        .eq("id", spotId);

      if (error) {
        console.error("clear flux spot error:", error);
        await ctx.answerCallbackQuery({
          text: "در حذف چاه فلوکس مشکلی پیش آمد.",
          show_alert: true,
        });
        return;
      }

      await ctx.answerCallbackQuery();
      await ctx.editMessageText("✅ چاه فلوکس این Spot حذف شد.");
      return;
    }

    // action === set
    const isEmergency = mode === "emergency";

    const { error } = await supabase
      .from("spots")
      .update({
        is_flux_station: true,
        has_emergency_flux: isEmergency,
      })
      .eq("id", spotId);

    if (error) {
      console.error("set flux spot error:", error);
      await ctx.answerCallbackQuery({
        text: "در تنظیم چاه فلوکس مشکلی پیش آمد.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      isEmergency
        ? "✅ این Spot به عنوان چاه اضطراری فلوکس ثبت شد."
        : "✅ این Spot به عنوان چاه فلوکس ثبت شد."
    );
  });
}
