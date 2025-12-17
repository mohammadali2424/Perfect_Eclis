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
    default:
      return key;
  }
}

function clanKeys(): ClanKey[] {
  return ["walker", "stellarieth", "necroshade", "torrentress"];
}

function clanKeyboardForRegister(): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(clanLabel("walker"), "regclan:walker").row();
  kb.text(clanLabel("stellarieth"), "regclan:stellarieth").row();
  kb.text(clanLabel("necroshade"), "regclan:necroshade").row();
  kb.text(clanLabel("torrentress"), "regclan:torrentress");
  return kb;
}

function mainMenuKeyboard(): any {
  return {
    keyboard: [
      [{ text: "🧭 مسیر های من" }, { text: "🗺 نقشه سریع من" }],
    ],
    resize_keyboard: true,
  };
}

async function sendMainMenuToUser(ctx: MyContext | null, userId: number) {
  const api = ctx ? ctx.api : null;
  if (!api) return;
  try {
    await api.sendMessage(
      userId,
      "از این لحظه می‌توانی از منوی مسیر و نقشه استفاده کنی.",
      {
        reply_markup: mainMenuKeyboard(),
      }
    );
  } catch (e) {
    console.error("sendMainMenuToUser failed:", e);
  }
}

export function registerOnboardingFeature(bot: Bot<MyContext>): void {
  // /start : فقط خوشامد + اگر تایید شده باشد منو
  bot.command("start", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      // در گروه‌ها امنیت guard کار خودش را می‌کند
      return;
    }

    const { supabase } = ctx.services;
    const tgId = ctx.from!.id;

    const { data: char, error } = await supabase
      .from("characters")
      .select("*")
      .eq("tg_id", tgId)
      .maybeSingle();

    let text =
      "به نقشه‌ی زندهٔ اکلیس خوش آمدی.\n" +
      "من مسئول مسیرها، سفرها و موقعیت‌ها هستم.\n\n" +
      "برای شروع ثبت‌نامت، در همین‌جا برایم بنویس: «ثبت من»";

    if (error) {
      console.error("characters select in /start error:", error);
    } else if (char) {
      if (char.is_approved) {
        text +=
          "\n\nثبت‌نامت قبلاً تایید شده است.\n" +
          "می‌توانی از دکمه‌های زیر استفاده کنی:";
        await ctx.reply(text, { reply_markup: mainMenuKeyboard() });
        return;
      } else {
        text +=
          "\n\nدر حال حاضر درخواستت در انتظار تایید ارباب است.\n" +
          "به‌محض تایید، می‌توانی از مسیرها و نقشه استفاده کنی.";
        await ctx.reply(text);
        return;
      }
    }

    await ctx.reply(text);
  });

  // ثبت من : شروع ثبت‌نام (انتخاب خاندان)
  bot.hears("ثبت من", async (ctx) => {
    if (ctx.chat?.type !== "private") return;

    const { supabase } = ctx.services;
    const tgId = ctx.from!.id;

    const { data: char, error } = await supabase
      .from("characters")
      .select("*")
      .eq("tg_id", tgId)
      .maybeSingle();

    if (error) {
      console.error("characters select in ثبت من error:", error);
      await ctx.reply("در بررسی وضعیت ثبت‌نام مشکلی پیش آمد.");
      return;
    }

    if (char?.is_approved) {
      await ctx.reply(
        "تو قبلاً در اکلیس ثبت شده‌ای.\n" +
          "از منوی زیر برای دیدن مسیرها و نقشه استفاده کن.",
        { reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    await ctx.reply(
      "برای ثبت تو در جهان اکلیس، ابتدا خاندان خودت را انتخاب کن:",
      {
        reply_markup: clanKeyboardForRegister(),
      }
    );
  });

  // callback ها: انتخاب خاندان + تایید/رد + لیست پلیرها و پروفایل‌شان
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";

    // ۱) انتخاب خاندان برای ثبت‌نام: regclan:...
    if (data.startsWith("regclan:")) {
      if (ctx.chat?.type !== "private") {
        await ctx.answerCallbackQuery();
        return;
      }

      const key = data.split(":")[1] as ClanKey;
      const clan = clanLabel(key);

      const { supabase } = ctx.services;
      const tgId = ctx.from!.id;
      const name =
        ctx.from!.first_name +
        (ctx.from!.last_name ? " " + ctx.from!.last_name : "");

      // ببین آیا قبلاً ردیفی برایش هست یا نه
      const { data: existing, error: exErr } = await supabase
        .from("characters")
        .select("*")
        .eq("tg_id", tgId)
        .maybeSingle();

      if (exErr) {
        console.error("characters select in regclan error:", exErr);
        await ctx.answerCallbackQuery({
          text: "در ثبت خاندان مشکلی پیش آمد.",
          show_alert: true,
        });
        return;
      }

      if (existing) {
        const { error: upErr } = await supabase
          .from("characters")
          .update({
            char_name: existing.char_name || name,
            clan_name: clan,
            is_approved: false,
            last_move_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (upErr) {
          console.error("characters update in regclan error:", upErr);
          await ctx.answerCallbackQuery({
            text: "در ثبت خاندان مشکلی پیش آمد.",
            show_alert: true,
          });
          return;
        }
      } else {
        const { error: insErr } = await supabase.from("characters").insert({
          tg_id: tgId,
          char_name: name,
          clan_name: clan,
          is_approved: false,
          last_move_at: new Date().toISOString(),
        });

        if (insErr) {
          console.error("characters insert in regclan error:", insErr);
          await ctx.answerCallbackQuery({
            text: "در ثبت خاندان مشکلی پیش آمد.",
            show_alert: true,
          });
          return;
        }
      }

      await ctx.answerCallbackQuery({
        text: `خاندان ${clan} ثبت شد. در انتظار تایید ارباب...`,
        show_alert: false,
      });

      await ctx.reply(
        "درخواست ثبت‌نامت ثبت شد.\n" +
          "وقتی ارباب تو را تایید کند، می‌توانی از مسیرها و نقشه استفاده کنی."
      );

      // پیام تایید برای ارباب
      try {
        const kb = new InlineKeyboard()
          .text("✅ تایید", `approve:${tgId}`)
          .text("❌ رد", `reject:${tgId}`);

        const text =
          "یک درخواست ثبت‌نام جدید:\n\n" +
          `کاربر: ${name}\n` +
          `tg_id: ${tgId}\n` +
          `خاندان: ${clan}\n\n` +
          "آیا تایید می‌کنی؟";

        await ctx.api.sendMessage(MASTER_ID, text, {
          reply_markup: kb,
        });
      } catch (e) {
        console.error("send registration to MASTER failed:", e);
      }

      return;
    }

    // ۲) تایید یا رد ثبت‌نام: approve:tg | reject:tg
    if (data.startsWith("approve:") || data.startsWith("reject:")) {
      if (!ctx.from || ctx.from.id !== MASTER_ID) {
        await ctx.answerCallbackQuery({
          text: "🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون",
          show_alert: true,
        });
        return;
      }

      const parts = data.split(":");
      const action = parts[0];
      const targetId = Number(parts[1]);

      const { supabase } = ctx.services;

      if (action === "approve") {
        const { data: char, error: charErr } = await supabase
          .from("characters")
          .select("*")
          .eq("tg_id", targetId)
          .maybeSingle();

        if (charErr || !char) {
          await ctx.answerCallbackQuery({
            text: "کاربر در دیتابیس پیدا نشد.",
            show_alert: true,
          });
          return;
        }

        const { error: upErr } = await supabase
          .from("characters")
          .update({
            is_approved: true,
            last_move_at: new Date().toISOString(),
          })
          .eq("id", char.id);

        if (upErr) {
          console.error("approve update error:", upErr);
          await ctx.answerCallbackQuery({
            text: "در تایید ثبت‌نام خطایی رخ داد.",
            show_alert: true,
          });
          return;
        }

        await ctx.answerCallbackQuery({ text: "پلیر تایید شد ✅" });

        // پیام به خود پلیر
        await sendMainMenuToUser(ctx, targetId);

        // ادیت پیام ارباب (اختیاری)
        try {
          await ctx.editMessageText(
            (ctx.callbackQuery.message?.text || "") + "\n\n✅ تایید شد."
          );
        } catch (e) {
          // مهم نیست اگر نشد
        }

        return;
      }

      if (action === "reject") {
        const { error: delErr } = await supabase
          .from("characters")
          .delete()
          .eq("tg_id", targetId);

        if (delErr) {
          console.error("reject delete error:", delErr);
          await ctx.answerCallbackQuery({
            text: "در رد کردن ثبت‌نام خطایی رخ داد.",
            show_alert: true,
          });
          return;
        }

        await ctx.answerCallbackQuery({ text: "درخواست رد شد ❌" });

        try {
          await ctx.editMessageText(
            (ctx.callbackQuery.message?.text || "") + "\n\n❌ رد شد."
          );
        } catch (_e) {}

        // پیام محترمانه به خود پلیر
        try {
          await ctx.api.sendMessage(
            targetId,
            "درخواست ثبت‌نامت در اکلیس توسط ارباب رد شد."
          );
        } catch (_e) {}

        return;
      }
    }

    // ۳) لیست پلیرها: plist:...
    if (data.startsWith("plist:")) {
      if (!ctx.from || ctx.from.id !== MASTER_ID) {
        await ctx.answerCallbackQuery({
          text: "🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون",
          show_alert: true,
        });
        return;
      }

      const key = data.split(":")[1]; // walker | ... | all
      const { supabase } = ctx.services;

      let query = supabase.from("characters").select("*");

      if (key !== "all") {
        const label = clanLabel(key as ClanKey);
        query = query.eq("clan_name", label);
      }

      const { data: chars, error: listErr } = await query;

      if (listErr) {
        console.error("list players error:", listErr);
        await ctx.answerCallbackQuery({
          text: "در خواندن لیست پلیرها خطایی رخ داد.",
          show_alert: true,
        });
        return;
      }

      await ctx.answerCallbackQuery();

      if (!chars || chars.length === 0) {
        await ctx.reply("هیچ پلیری با این فیلتر پیدا نشد.");
        return;
      }

      const kb = new InlineKeyboard();
      for (const c of chars) {
        const name = c.char_name || `بدون نام (${c.tg_id})`;
        kb.text(name, `pview:${c.tg_id}`).row();
      }

      await ctx.reply("لیست پلیرها:", { reply_markup: kb });
      return;
    }

    // ۴) مشاهده پروفایل پلیر: pview:tg
    if (data.startsWith("pview:")) {
      if (!ctx.from || ctx.from.id !== MASTER_ID) {
        await ctx.answerCallbackQuery({
          text: "🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون",
          show_alert: true,
        });
        return;
      }

      const tgId = Number(data.split(":")[1]);
      const { supabase } = ctx.services;

      const { data: char, error } = await supabase
        .from("characters")
        .select("*")
        .eq("tg_id", tgId)
        .maybeSingle();

      await ctx.answerCallbackQuery();

      if (error || !char) {
        await ctx.reply("این پلیر در دیتابیس پیدا نشد.");
        return;
      }

      let text =
        "پروفایل پلیر:\n\n" +
        `نام: ${char.char_name || "نامشخص"}\n` +
        `خاندان: ${char.clan_name || "نامشخص"}\n` +
        `tg_id: ${char.tg_id}\n` +
        `تایید شده: ${char.is_approved ? "بله" : "خیر"}\n`;

      if (char.last_move_at) {
        text += `آخرین فعالیت: ${char.last_move_at}\n`;
      }

      const kb = new InlineKeyboard().text(
        "🗑 حذف از ربات",
        `pdel:${tgId}`
      );

      await ctx.reply(text, { reply_markup: kb });
      return;
    }

    // ۵) حذف پلیر: pdel:tg
    if (data.startsWith("pdel:")) {
      if (!ctx.from || ctx.from.id !== MASTER_ID) {
        await ctx.answerCallbackQuery({
          text: "🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون",
          show_alert: true,
        });
        return;
      }

      const tgId = Number(data.split(":")[1]);
      const { supabase } = ctx.services;

      const { error: delErr } = await supabase
        .from("characters")
        .delete()
        .eq("tg_id", tgId);

      if (delErr) {
        console.error("delete player error:", delErr);
        await ctx.answerCallbackQuery({
          text: "در حذف پلیر خطایی رخ داد.",
          show_alert: true,
        });
        return;
      }

      await ctx.answerCallbackQuery({ text: "پلیر حذف شد 🗑" });

      try {
        await ctx.editMessageText("این پلیر از ربات حذف شد.");
      } catch (_e) {}

      return;
    }

    return next();
  });

  // لیست پلیرها: کلمهٔ فارسی + می‌توانی یک /listplayers هم اضافه کنی
  bot.hears("لیست پلیرها", async (ctx) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      await ctx.reply("🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون");
      return;
    }

    const kb = new InlineKeyboard();
    kb.text(clanLabel("walker"), "plist:walker").row();
    kb.text(clanLabel("stellarieth"), "plist:stellarieth").row();
    kb.text(clanLabel("necroshade"), "plist:necroshade").row();
    kb.text(clanLabel("torrentress"), "plist:torrentress").row();
    kb.text("همه پلیرها", "plist:all");

    await ctx.reply("لیست کدام خاندان را می‌خواهی؟", {
      reply_markup: kb,
    });
  });
}
