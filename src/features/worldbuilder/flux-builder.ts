// src/features/worldbuilder/flux-builder.ts
import { Bot } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

export function registerFluxBuilderFeature(bot: Bot<MyContext>): void {
  // /fluxwell add  و  /fluxwell remove
  bot.command("fluxwell", async (ctx) => {
    if (!ctx.from) return;

    // فقط ارباب
    if (ctx.from.id !== MASTER_ID) {
      await ctx.reply("فقط ارباب می‌تواند چاه فلوکس را مدیریت کند.");
      return;
    }

    const args = (ctx.message?.text ?? "").split(/\s+/).slice(1);
    const action = (args[0] ?? "").toLowerCase();

    if (!["add", "remove", "del", "delete"].includes(action)) {
      await ctx.reply(
        "استفاده:\n" +
          "/fluxwell add   → ساخت چاه فلوکس در همین ریجن/اسپات\n" +
          "/fluxwell remove → حذف چاه فلوکس در همین ریجن/اسپات"
      );
      return;
    }

    const { supabase } = ctx.services;

    // ریجن از روی چت فعلی
    const { data: region, error: regErr } = await supabase
      .from("regions")
      .select("id, title, telegram_chat_id")
      .eq("telegram_chat_id", ctx.chat?.id)
      .maybeSingle();

    if (regErr || !region) {
      await ctx.reply("این گروه به عنوان Region ثبت نشده.");
      return;
    }

    // اسپات: اولین spot همان ریجن (یا اگر خواستی بعداً با ریپلای/انتخاب دقیق‌ترش کن)
    const { data: spot, error: spErr } = await supabase
      .from("spots")
      .select("id, title")
      .eq("region_id", region.id)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (spErr || !spot) {
      await ctx.reply("این Region هنوز Spot ندارد.");
      return;
    }

    if (action === "add") {
      const { error } = await supabase.from("flux_wells").insert({
        region_id: region.id,
        spot_id: spot.id,
      });

      if (error) {
        // اگر unique constraint داری، ممکنه خطای تکراری بده
        console.error("fluxwell add error:", error);
        await ctx.reply("نتوانستم چاه فلوکس را بسازم (شاید از قبل وجود دارد).");
        return;
      }

      await ctx.reply(`⛽ چاه فلوکس ساخته شد: ${region.title} / ${spot.title}`);
      return;
    }

    // remove
    const { error } = await supabase
      .from("flux_wells")
      .delete()
      .eq("region_id", region.id)
      .eq("spot_id", spot.id);

    if (error) {
      console.error("fluxwell remove error:", error);
      await ctx.reply("نتوانستم چاه فلوکس را حذف کنم.");
      return;
    }

    await ctx.reply(`🧹 چاه فلوکس حذف شد: ${region.title} / ${spot.title}`);
  });
}
