import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";

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
    default:
      return key;
  }
}

function clanKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(clanLabel("walker"), "clan:walker").row();
  kb.text(clanLabel("stellarieth"), "clan:stellarieth").row();
  kb.text(clanLabel("necroshade"), "clan:necroshade").row();
  kb.text(clanLabel("torrentress"), "clan:torrentress");
  return kb;
}

export function registerOnboardingFeature(bot: Bot<MyContext>): void {
  // /start فقط در پی‌وی برای ثبت‌نام
  bot.command("start", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      // تو گروه‌ها، /start از طریق گارد محدود می‌شود، اینجا فقط نادیده می‌گیریم
      return;
    }

    ctx.session.reg_step = "clan";
    ctx.session.reg_clan = null;
    ctx.session.reg_name = null;

    const text =
      "به جهان اکلیس خوش آمدی.\n" +
      "در این جهان هر گروه یک منطقه است و تو از طریق من بین آن‌ها سفر می‌کنی.\n\n" +
      "اول از همه، خونِ خاندان خودت را انتخاب کن:";

    const msg = await ctx.reply(text, {
      reply_markup: clanKeyboard(),
    });

    ctx.session.ui_last_menu_id = msg.message_id;
  });

  // انتخاب خاندان با callback
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";

    if (data.startsWith("clan:")) {
      const key = data.split(":")[1] as ClanKey;
      const label = clanLabel(key);

      ctx.session.reg_step = "name";
      ctx.session.reg_clan = label;
      ctx.session.reg_name = null;

      await ctx.answerCallbackQuery({
        text: `خاندان ${label} انتخاب شد.`,
        show_alert: false,
      });

      await ctx.reply(
        "حالا نام کاراکترت را بفرست؛\n" +
          "همان نام و فونتی که معمولاً در رول‌پلی استفاده می‌کنی."
      );
      return;
    }

    return next();
  });

  // دریافت نام کاراکتر وقتی reg_step = "name" است
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "private") return next();

    if (ctx.session.reg_step !== "name") return next();

    const name = ctx.message.text.trim();
    if (!name) {
      await ctx.reply("نام کاراکتر نمی‌تواند خالی باشد.");
      return;
    }

    const clan = ctx.session.reg_clan || null;
    const tgId = ctx.from!.id;
    const { supabase } = ctx.services;

    // ببین قبلاً کاراکتر دارد یا نه
    const { data: existing, error: exErr } = await supabase
      .from("characters")
      .select("*")
      .eq("tg_id", tgId)
      .maybeSingle();

    if (exErr) {
      console.error("characters select error:", exErr);
      await ctx.reply("در بازیابی پروفایل اکلیس مشکلی پیش آمد.");
      return;
    }

    if (existing) {
      const { error: upErr } = await supabase
        .from("characters")
        .update({
          char_name: name,
          clan_name: clan,
        })
        .eq("id", existing.id);

      if (upErr) {
        console.error("characters update error:", upErr);
        await ctx.reply("در به‌روزرسانی شخصیتت مشکلی پیش آمد.");
        return;
      }
    } else {
      const { error: insErr } = await supabase.from("characters").insert({
        tg_id: tgId,
        char_name: name,
        clan_name: clan,
      });

      if (insErr) {
        console.error("characters insert error:", insErr);
        await ctx.reply("در ثبت شخصیتت مشکلی پیش آمد.");
        return;
      }
    }

    ctx.session.reg_step = undefined;
    ctx.session.reg_name = null;

    await ctx.reply(
      "ثبت‌نامت در اکلیس کامل شد ✅\n\n" +
        "از این به بعد می‌توانی از منوی:\n" +
        "🧭 «مسیر های من» برای دیدن راه‌های قابل حرکت\n" +
        "و 🗺 «نقشه سریع من» برای دیدن موقعیت فعلی‌ات استفاده کنی."
    );
  });

  // نمایش خلاصه پروفایل کاراکتر
  bot.command("whoami", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply("این دستور فقط در پی‌وی کار می‌کند.");
      return;
    }

    const { supabase } = ctx.services;
    const { data, error } = await supabase
      .from("characters")
      .select("char_name, clan_name")
      .eq("tg_id", ctx.from!.id)
      .maybeSingle();

    if (error || !data) {
      await ctx.reply("هنوز کاراکتری برایت ثبت نشده.");
      return;
    }

    await ctx.reply(
      "شناسه تو در اکلیس:\n" +
        `نام: ${data.char_name || "نامشخص"}\n` +
        `خاندان: ${data.clan_name || "نامشخص"}`
    );
  });
}
