// @ts-nocheck
import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";

const CLAN_LABEL: Record<string, string> = {
  stell: "🪽 Stellarieth",
  walk: "⚡ Walker",
  torr: "🔥 Torrentress",
  necr: "🩸 Necroshade",
};

export function registerRegistrationFeature(bot: Bot<MyContext>) {
  // --- ۱) شروع ثبت‌نام از PV ---

  // /register
  bot.command("register", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    const supabase = (ctx.services as any).supabase;
    const user = ctx.from!;
    const userId = user.id;

    // چک کنیم قبلاً ثبت شده یا نه
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
      await ctx.reply(
        "تو قبلاً در اکلیس ثبت شدی.\n" +
          `نام ثبت‌شده: <b>${(existing as any).display_name ?? "نام نامشخص"}</b>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const s = ctx.session as any;
    s.__reg_state = "ask_name";
    s.__reg_name = null;
    s.__reg_clan = null;

    await ctx.reply(
      "خوش آمدی به اکلیس.\n\n" +
        "اسم رول‌پلی که می‌خوای باهاش زندگی کنی رو برام بفرست.\n" +
        "مثال: 𝑵𝒐𝒙 • 𝑵𝒆𝒄𝒓𝒐𝒔𝒉𝒂𝒅𝒆"
    );
  });

  // متن «ثبت من» هم مثل /register عمل کند
  bot.hears("ثبت من", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    await bot.api.sendChatAction(ctx.chat.id, "typing");
    // مستقیم هندلر /register رو صدا نمی‌زنیم که ساده بماند
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
      await ctx.reply("یک خطای دیتابیسی رخ داد. بعداً دوباره تلاش کن.");
      return;
    }

    if (existing) {
      await ctx.reply(
        "تو قبلاً در اکلیس ثبت شدی.\n" +
          `نام ثبت‌شده: <b>${(existing as any).display_name ?? "نام نامشخص"}</b>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const s = ctx.session as any;
    s.__reg_state = "ask_name";
    s.__reg_name = null;
    s.__reg_clan = null;

    await ctx.reply(
      "خوش آمدی به اکلیس.\n\n" +
        "اسم رول‌پلی که می‌خوای باهاش زندگی کنی رو برام بفرست."
    );
  });

  // --- ۲) ادامه ثبت‌نام: دریافت اسم و انتخاب خاندان ---

  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    const s = ctx.session as any;
    const state = s.__reg_state as string | undefined;

    if (!state) {
      // این پیام مربوط به ثبت‌نام نیست، بقیه فیچرها رسیدگی کنن
      return;
    }

    const text = ctx.message.text.trim();
    const supabase = (ctx.services as any).supabase;
    const user = ctx.from!;
    const userId = user.id;

    // مرحله ۱: گرفتن اسم
    if (state === "ask_name") {
      if (text.length < 2) {
        await ctx.reply("اسم باید حداقل ۲ کاراکتر باشد. دوباره بفرست.");
        return;
      }

      s.__reg_name = text;
      s.__reg_state = "ask_clan";

      const kb = new InlineKeyboard()
        .text(CLAN_LABEL.stell, "reg_clan:stell")
        .row()
        .text(CLAN_LABEL.walk, "reg_clan:walk")
        .row()
        .text(CLAN_LABEL.torr, "reg_clan:torr")
        .row()
        .text(CLAN_LABEL.necr, "reg_clan:necr");

      await ctx.reply(
        "خاندان اولیه خودت رو انتخاب کن.\n" +
          "بعداً جهان می‌تونه تو رو عوض کنه، اما انتخاب اول همیشه مهمه.",
        { reply_markup: kb }
      );

      return;
    }

    // مرحله‌های دیگر ثبت‌نام (فعلاً فقط اسم و بعدش clan با callback) استفاده نمی‌کنند
  });

  // انتخاب خاندان با دکمه
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
        current_region_id: null,
        current_spot_id: null,
      });

      if (error) {
        console.error("supabase error (insert player):", error);
        await ctx.editMessageText(
          "خطا در ذخیره اطلاعات در اکلیس. بعداً دوباره تلاش کن."
        );
        return;
      }

      s.__reg_state = null;
      s.__reg_name = null;
      s.__reg_clan = null;

      await ctx.editMessageText(
        `ثبت‌نامت انجام شد.\n\n` +
          `نام: <b>${name}</b>\n` +
          `خاندان: <b>${clanLabel}</b>\n\n` +
          "ارباب باید تو رو به یک نقطه از جهان وصل کند تا سفرهایت شروع شود.",
        { parse_mode: "HTML" }
      );
    } catch (e) {
      console.error("unexpected error (reg_clan):", e);
      await ctx.editMessageText(
        "یک خطای غیرمنتظره رخ داد. بعداً دوباره تلاش کن."
      );
    }
  });

  // --- ۳) /regplayer در گروه (با ریپلای روی پیام پلیر) ---

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

    const supabase = (ctx.services as any).supabase;

    const targetUser = ctx.message.reply_to_message.from;
    const targetUserId = targetUser.id;
    const targetName =
      targetUser.first_name +
      (targetUser.last_name ? " " + targetUser.last_name : "");

    const chatId = ctx.chat.id;

    try {
      // پیدا کردن Region مربوط به این گروه
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

      // Spotهای این Region
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

      // پیغام تمیز کردن گروه
      try {
        await ctx.deleteMessage();
      } catch {}

      const s = ctx.session as any;
      s.__regpl_target_user_id = targetUserId;
      s.__regpl_target_username = targetUser.username ?? null;
      s.__regpl_target_name = targetName;

      // لیست Spotها در PV ادمین
      const kb = new InlineKeyboard();
      for (const sp of spots as any[]) {
        const label = sp.name ?? `Spot #${sp.id}`;
        kb.text(label, `regpl_spot:${sp.id}:${targetUserId}`).row();
      }

      await ctx.api.sendMessage(
        ctx.from!.id,
        `در حال ثبت پلیر:\n<b>${targetName}</b>\n\n` +
          "Spot شروع برای او را انتخاب کن:",
        {
          parse_mode: "HTML",
          reply_markup: kb,
        }
      );
    } catch (e) {
      console.error("unexpected error (/regplayer):", e);
      await ctx.reply("یک خطای غیرمنتظره رخ داد.");
    }
  });

  // انتخاب Spot شروع برای پلیر
  bot.callbackQuery(/^regpl_spot:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

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

      // ببینیم قبلاً پلیر وجود دارد یا نه
      const { data: existing, error: exErr } = await supabase
        .from("eclis_players")
        .select("*")
        .eq("user_id", playerUserId)
        .maybeSingle();

      if (exErr) {
        console.error("supabase error (regpl check player):", exErr);
        await ctx.editMessageText("خطا در بررسی اطلاعات پلیر.");
        return;
      }

      if (existing) {
        const { error: updErr } = await supabase
          .from("eclis_players")
          .update({
            username: (existing as any).username ?? null,
            current_region_id: regionId,
            current_spot_id: spotId,
          })
          .eq("user_id", playerUserId);

        if (updErr) {
          console.error("supabase error (regpl update player):", updErr);
          await ctx.editMessageText("خطا در به‌روزرسانی موقعیت پلیر.");
          return;
        }
      } else {
        // اگر پلیر قبلاً ثبت‌نام نکرده بود، حداقل با یک رکورد ساده بسازیم
        const s = ctx.session as any;
        const fallbackName =
          s.__regpl_target_name ??
          `User ${playerUserId.toString().slice(-4)} (بدون ثبت‌نام PV)`;

        const { error: insErr } = await supabase.from("eclis_players").insert({
          user_id: playerUserId,
          username: s.__regpl_target_username ?? null,
          display_name: fallbackName,
          clan: null,
          current_region_id: regionId,
          current_spot_id: spotId,
        });

        if (insErr) {
          console.error("supabase error (regpl insert player):", insErr);
          await ctx.editMessageText("خطا در ساخت پروفایل پلیر.");
          return;
        }
      }

      const spotName = (spot as any).name ?? `Spot #${spotId}`;

      await ctx.editMessageText(
        `پلیر با موفقیت ثبت شد.\n\n` +
          `مکان فعلی: <b>${spotName}</b> (Spot #${spotId})`,
        { parse_mode: "HTML" }
      );

      // سعی کنیم به خود پلیر هم پیام بدهیم (اگر قبلاً استارت زده باشد)
      try {
        await ctx.api.sendMessage(
          playerUserId,
          "شما توسط ارباب در یکی از نقاط جهان اکلیس ثبت شدی.\n" +
            `مکان فعلی‌ات: <b>${spotName}</b>`,
          { parse_mode: "HTML" }
        );
      } catch {
        // اگر پلیر هنوز به ربات /start نداده، این پیام fail می‌شود؛ مشکلی نیست
      }
    } catch (e) {
      console.error("unexpected error (regpl_spot):", e);
      try {
        await ctx.editMessageText("یک خطای غیرمنتظره رخ داد.");
      } catch {
        // پیام ممکن است قبلاً ادیت شده باشد
      }
    }
  });
}
