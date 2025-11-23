import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../core/types";
import { MASTER_ID } from "../core/config";

export function registerRegistrationFeature(bot: Bot<MyContext>) {
  // شروع ثبت‌نام با دستور یا متن "ثبت من"
  bot.command("sabteman", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply("برای ثبت‌نام، بیا پی‌وی من و اونجا بنویس: ثبت من");
      return;
    }

    ctx.session.reg_step = "name";
    ctx.session.reg_name = undefined;
    ctx.session.reg_clan = undefined;

    await ctx.reply("اسمت رو با همون فونتی که برای رول استفاده می‌کنی کپی کن و همینجا بفرست.");
  });

  // شنیدن متن «ثبت من» در پی‌وی
  bot.hears("ثبت من", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      return; // تو گروه اهمیتی نداره
    }

    ctx.session.reg_step = "name";
    ctx.session.reg_name = undefined;
    ctx.session.reg_clan = undefined;

    await ctx.reply("اسمت رو با همون فونتی که برای رول استفاده می‌کنی کپی کن و همینجا بفرست.");
  });

  // ویزارد ثبت‌نام در پی‌وی
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "private") {
      await next();
      return;
    }

    const step = ctx.session.reg_step;
    if (!step) {
      await next();
      return;
    }

    const { supabase } = ctx.services;
    const text = ctx.message.text.trim();

    // مرحله اول: اسم
    if (step === "name") {
      if (!text) {
        await ctx.reply("اسم نمی‌تونه خالی باشه. دوباره بفرست.");
        return;
      }

      ctx.session.reg_name = text;
      ctx.session.reg_step = "clan";

      await ctx.reply(
        "حالا اسم خاندانت رو با فونت خاصش بفرست.\n" +
          "مثال: 𝑺𝒕𝒆𝒍𝒍𝒂𝒓𝒊𝒆𝒕𝒉 یا 𝑻𝒐𝒓𝒓𝒆𝒏𝒕𝒓𝒆𝒔 ..."
      );
      return;
    }

    // مرحله دوم: خاندان
    if (step === "clan") {
      if (!text) {
        await ctx.reply("اسم خاندان نمی‌تونه خالی باشه. دوباره بفرست.");
        return;
      }

      const name = ctx.session.reg_name;
      if (!name) {
        // سیشن خراب شده
        ctx.session.reg_step = undefined;
        await ctx.reply("یه خطای کوچک رخ داد. دوباره «ثبت من» رو بفرست.");
        return;
      }

      ctx.session.reg_clan = text;

      // ذخیره تو جدول درخواست‌ها
      const { data: row, error: insErr } = await supabase
        .from("pending_registrations")
        .insert({
          tg_id: ctx.from!.id,
          display_name: name,
          clan_name: text,
        })
        .select("id")
        .single();

      if (insErr || !row) {
        console.error("pending_registrations insert error:", insErr);
        ctx.session.reg_step = undefined;
        await ctx.reply("در ثبت درخواست مشکلی پیش اومد. بعداً دوباره امتحان کن.");
        return;
      }

      // پاک کردن مراحل از سیشن
      ctx.session.reg_step = undefined;
      ctx.session.reg_name = undefined;
      ctx.session.reg_clan = undefined;

      await ctx.reply("درخواست ثبت‌نامت ثبت شد. بعد از تأیید ارباب، بهت خبر می‌دم.");

      // پیام برای ارباب
      const kb = new InlineKeyboard()
        .text("تایید ✅", `reg:approve:${row.id}`)
        .text("رد ❌", `reg:deny:${row.id}`);

      const user = ctx.from!;
      const usernameText = user.username ? `@${user.username}` : "بدون یوزرنیم";

      await ctx.api.sendMessage(
        MASTER_ID,
        [
          "درخواست ثبت‌نام جدید:",
          `👤 نام: ${name}`,
          `🏰 خاندان: ${text}`,
          `🆔 تلگرام: ${usernameText} (id: ${user.id})`,
        ].join("\n"),
        { reply_markup: kb }
      );

      return;
    }

    await next();
  });

  // تأیید / رد ثبت‌نام توسط ارباب
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    if (!data.startsWith("reg:")) {
      await next();
      return;
    }

    if (ctx.from?.id !== MASTER_ID) {
      await ctx.answerCallbackQuery({
        text: "فقط اربابم میتونه ثبت‌نام‌ها رو تأیید کنه، حدتو بدون.",
        show_alert: true,
      });
      return;
    }

    const { supabase } = ctx.services;

    if (data.startsWith("reg:approve:")) {
      const idStr = data.split(":")[2];
      const id = Number(idStr);
      await ctx.answerCallbackQuery();

      const { data: row, error } = await supabase
        .from("pending_registrations")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !row) {
        console.error("pending_registrations fetch error:", error);
        await ctx.reply("درخواست پیدا نشد (شاید قبلاً رسیدگی شده).");
        return;
      }

      const tgId: number = row.tg_id;
      const displayName: string = row.display_name;
      const clanName: string = row.clan_name;

      // ببین کاراکترش وجود داره یا نه
      const { data: char, error: charErr } = await supabase
        .from("characters")
        .select("*")
        .eq("tg_id", tgId)
        .maybeSingle();

      if (charErr) {
        console.error("characters select error:", charErr);
      }

      if (char) {
        // آپدیت
        const { error: updErr } = await supabase
          .from("characters")
          .update({
            char_name: displayName,
            clan_name: clanName,
          })
          .eq("tg_id", tgId);

        if (updErr) {
          console.error("characters update error:", updErr);
          await ctx.reply("خطا در به‌روزرسانی کاراکتر.");
          return;
        }
      } else {
        // اینسرت
        const { error: insCharErr } = await supabase.from("characters").insert({
          tg_id: tgId,
          char_name: displayName,
          clan_name: clanName,
          current_region_id: null,
          current_spot_id: null,
          last_move_at: null,
          travel_ready_at: null,
          pending_region_id: null,
          pending_spot_id: null,
        });

        if (insCharErr) {
          console.error("characters insert error:", insCharErr);
          await ctx.reply("خطا در ساخت رکورد کاراکتر.");
          return;
        }
      }

      // پاک کردن درخواست
      await supabase.from("pending_registrations").delete().eq("id", id);

      await ctx.reply(`درخواست ثبت‌نام تأیید شد و کاراکتر «${displayName}» ثبت شد.`);

      // خبر دادن به خود شخص
      try {
        await ctx.api.sendMessage(
          tgId,
          `درخواست ثبت‌نامت تأیید شد.\nنام: ${displayName}\nخاندان: ${clanName}`
        );
      } catch {
        // اگر پی‌وی باز نکرده بود، هیچی
      }

      return;
    }

    if (data.startsWith("reg:deny:")) {
      const idStr = data.split(":")[2];
      const id = Number(idStr);
      await ctx.answerCallbackQuery();

      const { data: row, error } = await supabase
        .from("pending_registrations")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !row) {
        await ctx.reply("درخواست پیدا نشد (شاید قبلاً رسیدگی شده).");
        return;
      }

      const tgId: number = row.tg_id;

      await supabase.from("pending_registrations").delete().eq("id", id);

      await ctx.reply("درخواست ثبت‌نام رد شد.");

      try {
        await ctx.api.sendMessage(
          tgId,
          "درخواست ثبت‌نامت توسط ارباب رد شد. اگر فکر می‌کنی اشتباه شده، با مدیریت صحبت کن."
        );
      } catch {}

      return;
    }

    await next();
  });
}
