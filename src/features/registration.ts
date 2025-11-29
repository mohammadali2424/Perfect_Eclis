// @ts-nocheck
import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../core/types";
import { MASTER_ID } from "../core/config";

// اسم خوشگل خاندان‌ها
const CLAN_LABEL: Record<string, string> = {
  stell: "🪽 Stellarieth",
  walk:  "⚡ Walker",
  torr:  "🔥 Torrentress",
  necr:  "🩸 Necroshade",
};

// ارباب ربات
const OWNER_ID = MASTER_ID;

export function registerRegistrationFeature(bot: Bot<MyContext>) {
  // -------------------------
  // ۱) ثبت‌نام توی PV (ثبت من / register)
  // -------------------------

  // /register
  bot.command("register", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    const supabase = (ctx.services as any).supabase;
    const user = ctx.from!;
    const userId = user.id;

    const { data: existing, error } = await supabase
      .from("eclis_players")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("supabase error (check player):", error);
      await ctx.reply("یک خطای دیتابیسی رخ داد. بعداً دوباره تلاش کن.");
      return;
    }

    if (existing) {
      const ex: any = existing;
      if (ex.approved) {
        await ctx.reply(
          "تو قبلاً توسط ارباب در اکلیس ثبت و تأیید شدی.\n" +
            `نام ثبت‌شده: <b>${ex.display_name ?? "نام نامشخص"}</b>`,
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.reply(
          "درخواست ثبت‌نامت ثبت شده و در انتظار تأیید ارباب است.\n" +
            "فعلاً دسترسی کامل به ربات نداری."
        );
      }
      return;
    }

    const s = ctx.session as any;
    s.__reg_state = "ask_name";
    s.__reg_name = null;
    s.__reg_clan = null;

    await ctx.reply(
      "به اکلیس خوش اومدی.\n\n" +
        "اسم رول‌پلی که می‌خوای باهاش زندگی کنی رو برام بفرست.\n" +
        "مثال: 𝑵𝒐𝒙 • 𝑵𝒆𝒄𝒓𝒐𝒔𝒉𝒂𝒅𝒆"
    );
  });

  // «ثبت من» = شورتکات برای /register
  bot.hears("ثبت من", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    const supabase = (ctx.services as any).supabase;
    const user = ctx.from!;
    const userId = user.id;

    const { data: existing, error } = await supabase
      .from("eclis_players")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("supabase error (check player via hears):", error);
      await ctx.reply("یک خطای دیتابیسی رخ داد. بعداً دوباره امتحان کن.");
      return;
    }

    if (existing) {
      const ex: any = existing;
      if (ex.approved) {
        await ctx.reply(
          "تو قبلاً توسط ارباب تأیید شدی.\n" +
            `نام ثبت‌شده: <b>${ex.display_name ?? "نام نامشخص"}</b>`,
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.reply(
          "درخواستت ثبت شده و در انتظار تأیید ارباب است.\n" +
            "بعد از تأیید، مسیرها برای تو باز می‌شن."
        );
      }
      return;
    }

    const s = ctx.session as any;
    s.__reg_state = "ask_name";
    s.__reg_name = null;
    s.__reg_clan = null;

    await ctx.reply(
      "به اکلیس خوش اومدی.\n\n" +
        "اسم رول‌پلی‌ات رو برام بفرست."
    );
  });

  // مرحله‌های ثبت‌نام در PV (اسم → انتخاب خاندان)
  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const s = ctx.session as any;
    const state = s.__reg_state as string | undefined;
    if (!state) return;

    const text = ctx.message.text.trim();

    if (state === "ask_name") {
      if (text.length < 2) {
        await ctx.reply("اسم باید حداقل ۲ کاراکتر باشد. دوباره بفرست.");
        return;
      }

      s.__reg_name = text;
      s.__reg_state = "ask_clan";

      const kb = new InlineKeyboard()
        .text(CLAN_LABEL.stell, "reg_clan:stell").row()
        .text(CLAN_LABEL.walk,  "reg_clan:walk").row()
        .text(CLAN_LABEL.torr,  "reg_clan:torr").row()
        .text(CLAN_LABEL.necr,  "reg_clan:necr");

      await ctx.reply(
        "خاندان اولیه‌ات رو انتخاب کن.\n" +
          "این فقط شروعه؛ سرنوشت ممکنه بعداً تو رو جابه‌جا کنه.",
        { reply_markup: kb }
      );
      return;
    }
  });

  // انتخاب خاندان → ساخت پلیر + پیام به ارباب
  bot.callbackQuery(/^reg_clan:(.+)$/, async (ctx) => {
    if (ctx.chat.type !== "private") return;
    await ctx.answerCallbackQuery();

    const s = ctx.session as any;
    const state = s.__reg_state as string | undefined;
    const name = s.__reg_name as string | undefined;

    if (state !== "ask_clan" || !name) {
      await ctx.editMessageText("ثبت‌نام ناقص است. دوباره «ثبت من» را بفرست.");
      s.__reg_state = null;
      s.__reg_name = null;
      s.__reg_clan = null;
      return;
    }

    const clanId = (ctx.match as RegExpMatchArray)[1];
    const clanLabel = CLAN_LABEL[clanId] ?? clanId;

    const supabase = (ctx.services as any).supabase;
    const user = ctx.from!;
    const userId = user.id;

    try {
      const { error } = await supabase.from("eclis_players").insert({
        user_id: userId,
        username: user.username ?? null,
        display_name: name,
        clan: clanId,
        approved: false,
        current_region_id: null,
        current_spot_id: null,
      });

      if (error) {
        console.error("supabase error (insert player):", error);
        await ctx.editMessageText("خطا در ذخیره اطلاعات. بعداً دوباره تلاش کن.");
        return;
      }

      s.__reg_state = null;
      s.__reg_name = null;
      s.__reg_clan = null;

      await ctx.editMessageText(
        `درخواست ثبت‌نامت ثبت شد.\n\n` +
          `نام: <b>${name}</b>\n` +
          `خاندان: <b>${clanLabel}</b>\n\n` +
          "حالا ارباب باید تو را تأیید کند.",
        { parse_mode: "HTML" }
      );

      if (OWNER_ID) {
        const kb = new InlineKeyboard()
          .text("✅ تأیید", `regappr:${userId}:ok`).row()
          .text("❌ رد", `regappr:${userId}:no`);

        await ctx.api.sendMessage(
          OWNER_ID,
          `درخواست جدید ثبت‌نام در اکلیس:\n\n` +
            `👤 نام: <b>${name}</b>\n` +
            `🏷 یوزرنیم: @${user.username ?? "بدون یوزرنیم"}\n` +
            `🩸 خاندان: <b>${clanLabel}</b>\n` +
            `🆔 user_id: <code>${userId}</code>`,
          { parse_mode: "HTML", reply_markup: kb }
        );
      }
    } catch (e) {
      console.error("unexpected error (reg_clan):", e);
      await ctx.editMessageText("یک خطای غیرمنتظره رخ داد.");
    }
  });

  // ارباب: تأیید / رد
  bot.callbackQuery(/^regappr:(\d+):(ok|no)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    if (!OWNER_ID || ctx.from!.id !== OWNER_ID) {
      await ctx.reply("فقط اربابم حق این کار را دارد، حدت را بدان.");
      return;
    }

    const supabase = (ctx.services as any).supabase;
    const match = ctx.match as RegExpMatchArray;
    const userId = Number(match[1]);
    const decision = match[2];

    const { data: player, error } = await supabase
      .from("eclis_players")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !player) {
      console.error("supabase error (regappr get player):", error);
      try {
        await ctx.editMessageText("پلیر پیدا نشد یا خطای دیتابیسی رخ داد.");
      } catch {}
      return;
    }

    if (decision === "no") {
      const { error: delErr } = await supabase
        .from("eclis_players")
        .delete()
        .eq("user_id", userId);

      if (delErr) {
        console.error("supabase error (regappr delete):", delErr);
        await ctx.editMessageText("خطا در رد کردن درخواست.");
        return;
      }

      await ctx.editMessageText(
        `درخواست این پلیر رد شد و از لیست پاک شد.\n\n` +
          `نام: ${(player as any).display_name ?? "-"}`
      );

      try {
        await ctx.api.sendMessage(
          userId,
          "درخواست ورود تو به اکلیس توسط ارباب رد شد."
        );
      } catch {}

      return;
    }

    const { error: updErr } = await supabase
      .from("eclis_players")
      .update({ approved: true })
      .eq("user_id", userId);

    if (updErr) {
      console.error("supabase error (regappr approve):", updErr);
      await ctx.editMessageText("خطا در تأیید پلیر.");
      return;
    }

    await ctx.editMessageText(
      `پلیر تأیید شد.\n\n` +
        `نام: <b>${(player as any).display_name ?? "-"}</b>`,
      { parse_mode: "HTML" }
    );

    try {
      await ctx.api.sendMessage(
        userId,
        "درخواستت توسط ارباب تأیید شد.\n" +
          "حالا ارباب می‌تواند مکان شروع تو را در جهان مشخص کند."
      );
    } catch {}
  });

  // -----------------------------
  // ۲) /regplayer در گروه (لوکیشن)
  // -----------------------------

  bot.command("regplayer", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") {
      await ctx.reply("این دستور باید داخل گروه روی پیام یک پلیر ریپلای شود.");
      return;
    }

    if (!ctx.message?.reply_to_message || !ctx.message.reply_to_message.from) {
      await ctx.reply(
        "برای استفاده از این دستور، روی پیام پلیر موردنظر ریپلای کن و بعد /regplayer را بزن."
      );
      return;
    }

    if (!OWNER_ID || ctx.from!.id !== OWNER_ID) {
      await ctx.reply("فقط اربابم می‌تواند موقعیت پلیرها را تعیین کند، حدت را بدان.");
      return;
    }

    const supabase = (ctx.services as any).supabase;

    const targetUser = ctx.message.reply_to_message.from;
    const targetUserId = targetUser.id;
    const targetName =
      targetUser.first_name +
      (targetUser.last_name ? " " + targetUser.last_name : "");

    const chatId = ctx.chat.id;

    try {
      const { data: player, error: plErr } = await supabase
        .from("eclis_players")
        .select("*")
        .eq("user_id", targetUserId)
        .maybeSingle();

      if (plErr) {
        console.error("supabase error (regplayer get player):", plErr);
        await ctx.reply("خطا در بررسی وضعیت پلیر.");
        return;
      }

      if (!player) {
        await ctx.reply(
          "این کاربر هنوز در اکلیس ثبت‌نام نکرده.\n" +
            "باید اول در PV ربات «ثبت من» را بفرستد."
        );
        return;
      }

      if (!(player as any).approved) {
        await ctx.reply(
          "این کاربر هنوز توسط ارباب تأیید نشده.\n" +
            "بعد از تأیید، می‌توانی موقعیتش را ثبت کنی."
        );
        return;
      }

      const { data: region, error: regErr } = await supabase
        .from("eclis_regions")
        .select("*")
        .eq("chat_id", chatId)
        .maybeSingle();

      if (regErr) {
        console.error("supabase error (get region for regplayer):", regErr);
        await ctx.reply("خطا در دریافت Region این گروه.");
        return;
      }

      if (!region) {
        await ctx.reply(
          "برای این گروه هنوز Region ثبت نشده.\n" +
            "اول با /aw در این گروه Region را ثبت کن."
        );
        return;
      }

      const regionId = (region as any).id;

      const { data: spots, error: spotErr } = await supabase
        .from("eclis_spots")
        .select("*")
        .eq("region_id", regionId)
        .order("id", { ascending: true });

      if (spotErr) {
        console.error("supabase error (get spots for regplayer):", spotErr);
        await ctx.reply("خطا در دریافت Spotهای این Region.");
        return;
      }

      if (!spots || (spots as any[]).length === 0) {
        await ctx.reply(
          "برای این Region هنوز Spot تعریف نشده.\n" +
            "اول از پنل /aw یک Spot برای این گروه بساز."
        );
        return;
      }

      try {
        await ctx.deleteMessage();
      } catch {}

      const kb = new InlineKeyboard();
      for (const sp of spots as any[]) {
        const label = sp.name ?? `Spot #${sp.id}`;
        kb.text(label, `regpl_spot:${sp.id}:${targetUserId}`).row();
      }

      await ctx.api.sendMessage(
        OWNER_ID,
        `در حال ثبت موقعیت برای پلیر:\n<b>${targetName}</b>\n\n` +
          "Spot شروع او را انتخاب کن:",
        { parse_mode: "HTML", reply_markup: kb }
      );
    } catch (e) {
      console.error("unexpected error (/regplayer):", e);
      await ctx.reply("یک خطای غیرمنتظره رخ داد.");
    }
  });

  // انتخاب Spot در PV ارباب
  bot.callbackQuery(/^regpl_spot:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    if (!OWNER_ID || ctx.from!.id !== OWNER_ID) {
      await ctx.reply("فقط اربابم حق این کار را دارد، حدت را بدان.");
      return;
    }

    const supabase = (ctx.services as any).supabase;
    const match = ctx.match as RegExpMatchArray;
    const spotId = Number(match[1]);
    const playerUserId = Number(match[2]);

    try {
      const { data: spot, error: spotErr } = await supabase
        .from("eclis_spots")
        .select("*")
        .eq("id", spotId)
        .maybeSingle();

      if (spotErr || !spot) {
        console.error("supabase error (regpl get spot):", spotErr);
        await ctx.editMessageText("Spot موردنظر پیدا نشد.");
        return;
      }

      const regionId = (spot as any).region_id;

      const { data: player, error: plErr } = await supabase
        .from("eclis_players")
        .select("*")
        .eq("user_id", playerUserId)
        .maybeSingle();

      if (plErr || !player) {
        console.error("supabase error (regpl get player):", plErr);
        await ctx.editMessageText("پلیر پیدا نشد.");
        return;
      }

      const { error: updErr } = await supabase
        .from("eclis_players")
        .update({
          current_region_id: regionId,
          current_spot_id: spotId,
        })
        .eq("user_id", playerUserId);

      if (updErr) {
        console.error("supabase error (regpl update player):", updErr);
        await ctx.editMessageText("خطا در به‌روزرسانی موقعیت پلیر.");
        return;
      }

      const spotName = (spot as any).name ?? `Spot #${spotId}`;

      await ctx.editMessageText(
        `پلیر با موفقیت در جهان اکلیس مستقر شد.\n\n` +
          `مکان فعلی: <b>${spotName}</b> (Spot #${spotId})`,
        { parse_mode: "HTML" }
      );

      try {
        await ctx.api.sendMessage(
          playerUserId,
          "ارباب موقعیتت را در جهان اکلیس تعیین کرد.\n" +
            `مکان فعلی تو: <b>${spotName}</b>`,
          { parse_mode: "HTML" }
        );
      } catch {}
    } catch (e) {
      console.error("unexpected error (regpl_spot):", e);
      try {
        await ctx.editMessageText("یک خطای غیرمنتظره رخ داد.");
      } catch {}
    }
  });
}
