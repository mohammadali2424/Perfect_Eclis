import { Bot, InlineKeyboard } from "grammy";
  import { MyContext } from "../../core/types";
  import { MASTER_ID } from "../../core/config";

  type ClanKey = "walker" | "stellarieth" | "necroshade" | "torrentress";

  function clanLabel(key: ClanKey): string {
    switch (key) {
      case "walker":
        return "⚡ 𝐖𝐚𝐥𝐤𝐞𝐫";
      case "stellarieth":
        return "🪽 𝐒𝐭𝐞𝐥𝐥𝐚𝐫𝐢𝐞𝐭𝐡";
      case "necroshade":
        return "🖤 𝐍𝐞𝐜𝐫𝐨𝐬𝐡𝐚𝐝𝐞";
      case "torrentress":
        return "🌟 𝐓𝐨𝐫𝐫𝐞𝐧𝐭𝐫𝐞𝐬𝐬";
    }
  }

  function buildClanKeyboard(): InlineKeyboard {
    const kb = new InlineKeyboard();
    kb.text(clanLabel("walker"), "clan:walker").row();
    kb.text(clanLabel("stellarieth"), "clan:stellarieth").row();
    kb.text(clanLabel("necroshade"), "clan:necroshade").row();
    kb.text(clanLabel("torrentress"), "clan:torrentress").row();
    return kb;
  }

  async function askClan(ctx: MyContext) {
    const text =
      "✨ به کتاب زنده‌ی اکلیس خوش آمدی.

" +
      "خونت به کدام خاندان تعلق دارد؟";
    ctx.session.reg_step = "clan";
    ctx.session.reg_clan = null;
    ctx.session.reg_name = null;

    const msg = await ctx.reply(text, {
      reply_markup: buildClanKeyboard(),
    });
    ctx.session.ui_last_menu_id = msg.message_id;
  }

  async function askName(ctx: MyContext, clan: ClanKey) {
    const label = clanLabel(clan);
    const text =
      `🩸 مهر ${label} بر صفحه‌ی اطلس ظاهر می‌شود…

` +
      "📜 حالا نام کاراکتر خود را بفرست:
" +
      "(با همان فونتی که در رول‌پلی استفاده می‌کنی)";
    ctx.session.reg_step = "name";
    ctx.session.reg_clan = clan;
    ctx.session.reg_name = null;

    const msg = await ctx.reply(text);
    ctx.session.ui_last_menu_id = msg.message_id;
  }

  async function finishRegistration(ctx: MyContext) {
    const { supabase } = ctx.services;
    const clan = ctx.session.reg_clan;
    const name = ctx.session.reg_name;

    if (!clan || !name || !ctx.from) {
      await ctx.reply("اطلاعات ثبت‌نام ناقص است.");
      return;
    }

    const { data: existing, error: selErr } = await supabase
      .from("characters")
      .select("id")
      .eq("tg_id", ctx.from.id)
      .maybeSingle();

    if (selErr) {
      console.error("characters select error (finishRegistration):", selErr);
    }

    if (existing) {
      const { error: updErr } = await supabase
        .from("characters")
        .update({
          char_name: name,
          clan_name: clanLabel(clan),
        })
        .eq("tg_id", ctx.from.id);
      if (updErr) {
        console.error("characters update error (finishRegistration):", updErr);
        await ctx.reply("در به‌روزرسانی کاراکتر خطایی رخ داد.");
        return;
      }
    } else {
      const { error: insErr } = await supabase.from("characters").insert({
        tg_id: ctx.from.id,
        char_name: name,
        clan_name: clanLabel(clan),
      });
      if (insErr) {
        console.error("characters insert error (finishRegistration):", insErr);
        await ctx.reply("در ساخت کاراکتر خطایی رخ داد.");
        return;
      }
    }

    ctx.session.reg_step = undefined;
    ctx.session.reg_clan = null;
    ctx.session.reg_name = null;

    await ctx.reply(
      "ثبت‌نامت در اکلیس کامل شد. 🗺
" +
        "از این به بعد می‌توانی از منوی:
" +
        "🧭 «مسیر های من» و 🗺 «نقشه سریع من» استفاده کنی."
    );
  }

  export function registerOnboardingFeature(bot: Bot<MyContext>): void {
    // /start در پی‌وی
    bot.command("start", async (ctx) => {
      if (ctx.chat?.type !== "private") {
        await ctx.reply("برای شروع، به پی‌وی من بیا.");
        return;
      }
      await askClan(ctx);
    });

    // انتخاب خاندان
    bot.on("callback_query:data", async (ctx, next) => {
      const data = ctx.callbackQuery.data || "";
      if (!data.startsWith("clan:")) return next();

      await ctx.answerCallbackQuery();

      const clanKey = data.split(":")[1] as ClanKey;
      if (!["walker", "stellarieth", "necroshade", "torrentress"].includes(clanKey)) {
        return;
      }

      await askName(ctx, clanKey);
    });

    // دریافت نام بعد از انتخاب خاندان
    bot.on("message:text", async (ctx, next) => {
      if (ctx.chat?.type !== "private") return next();
      if (ctx.session.reg_step !== "name") return next();

      const name = ctx.message.text.trim();
      if (!name) {
        await ctx.reply("نام خالی قابل قبول نیست.");
        return;
      }

      ctx.session.reg_name = name;
      await finishRegistration(ctx);
    });

    // راه سریع ارباب برای تست (بدون ثبت در دیتابیس)
    bot.command("whoami", async (ctx) => {
      if (ctx.chat?.type !== "private") return;
      if (!ctx.from) return;

      const { supabase } = ctx.services;
      const { data, error } = await supabase
        .from("characters")
        .select("*")
        .eq("tg_id", ctx.from.id)
        .maybeSingle();

      if (error || !data) {
        await ctx.reply("هنوز کاراکتری برایت ثبت نشده.");
        return;
      }

      await ctx.reply(
        "شناسه تو در اکلیس:
" +
          `نام: ${data.char_name || "نامشخص"}
` +
          `خاندان: ${data.clan_name || "نامشخص"}`
      );
    });
  }