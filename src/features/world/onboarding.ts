import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";

// فونت‌های unified برای خاندان‌ها (همه تو استایل Torrentress)
const CLAN_STELL = "🪽 𝑺𝒕𝒆𝒍𝒍𝒂𝒓𝒊𝒆𝒕𝒉";
const CLAN_WALK = "⚡ 𝑾𝒂𝒍𝒌𝒆𝒓";
const CLAN_NECRO = "🖤 𝑵𝒆𝒄𝒓𝒐𝒔𝒉𝒂𝒅𝒆";
const CLAN_TORR = "🔥 𝑻𝒐𝒓𝒓𝒆𝒏𝒕𝒓𝒆𝒔𝒔";

type ClanKey = "Stellarieth" | "Walker" | "Necroshade" | "Torrentress";

const CLAN_LABELS: Record<ClanKey, string> = {
  Stellarieth: CLAN_STELL,
  Walker: CLAN_WALK,
  Necroshade: CLAN_NECRO,
  Torrentress: CLAN_TORR,
};

function labelFromKey(key: ClanKey): string {
  return CLAN_LABELS[key];
}

// پاک کردن آخرین «صفحه منو» توی PV
async function deleteUiPage(ctx: MyContext) {
  try {
    if (ctx.chat?.type === "private" && ctx.session.ui_last_menu_id) {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.session.ui_last_menu_id);
    }
  } catch {
    // اگر دسترسی حذف نداشت، مهم نیست
  }
  ctx.session.ui_last_menu_id = undefined;
}

// ارسال صفحه جدید و ذخیره message_id
async function sendUiPage(
  ctx: MyContext,
  text: string,
  extra: Parameters<MyContext["reply"]>[1] = {}
) {
  await deleteUiPage(ctx);
  const msg = await ctx.reply(text, extra);
  ctx.session.ui_last_menu_id = msg.message_id;
}

// ساخت/گرفتن کاراکتر از Supabase
async function ensureCharacterFor(ctx: MyContext, tgId: number) {
  const { supabase } = ctx.services;

  const { data: char, error } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", tgId)
    .maybeSingle();

  if (!error && char) return char;

  const { data: inserted, error: insErr } = await supabase
    .from("characters")
    .insert({
      tg_id: tgId,
      char_name: null,
      clan_name: null,
      current_region_id: null,
      current_spot_id: null,
      last_move_at: null,
      travel_ready_at: null,
      pending_region_id: null,
      pending_spot_id: null,
    })
    .select("*")
    .single();

  if (insErr || !inserted) {
    console.error("characters insert error (onboarding):", insErr);
    throw new Error("cannot init character");
  }

  return inserted;
}

async function ensureCharacter(ctx: MyContext) {
  return ensureCharacterFor(ctx, ctx.from!.id);
}

// منوی اصلی اطلس بعد از ثبت‌نام
async function showMainAtlasMenu(ctx: MyContext) {
  const char = await ensureCharacter(ctx);

  const clanLabel = char.clan_name
    ? labelFromKey(char.clan_name as ClanKey)
    : "❓ خاندان نامشخص";

  const text =
    "📜✨ 𝑨𝒓𝒄𝒂𝒏𝒆 𝑨𝒕𝒍𝒂𝒔 — اطلس باستانی سفر\n\n" +
    "صفحه‌های تو اکنون روشن‌اند، مسافر اکلیس.\n\n" +
    `🧬 خون تو ثبت شده است:\n${clanLabel}\n\n` +
    "از اینجا می‌توانی به مسیرها و جهان دسترسی بگیری.\n\n" +
    "برای دیدن مسیرهایت، از دکمه‌ی «🧭 مسیر های من» در پایین استفاده کن.\n" +
    "در نسخه‌های بعدی، اینجا صفحات بیشتری باز خواهد شد…";

  await sendUiPage(ctx, text);
}

// صفحه انتخاب خاندان
async function showClanSelect(ctx: MyContext) {
  const text =
    "🜂 انتخاب خاندان\n" +
    "-------------------------\n" +
    "پیش از آنکه قدم در مسیر بگذاری، باید خون تو شناخته شود…\n\n" +
    "از کدام خاندانی هستی؟";

  const kb = new InlineKeyboard()
    .text(CLAN_STELL, "reg_clan:Stellarieth")
    .row()
    .text(CLAN_WALK, "reg_clan:Walker")
    .row()
    .text(CLAN_NECRO, "reg_clan:Necroshade")
    .row()
    .text(CLAN_TORR, "reg_clan:Torrentress");

  ctx.session.reg_step = "clan";
  ctx.session.reg_clan = null;
  ctx.session.reg_name = null;

  await sendUiPage(ctx, text, { reply_markup: kb });
}

async function showClanLoadingAndAskName(ctx: MyContext, clanKey: ClanKey) {
  const label = labelFromKey(clanKey);

  const text =
    "🩸 مهر خاندان بر صفحه‌ی اطلس ظاهر می‌شود…\n" +
    `${label}\n\n` +
    "✨ خونت با کتاب هم‌صدا می‌شود.\n" +
    "ᚦᚱᚨ ᚹᚨ ᚱᚾ…\n\n" +
    "▰▱▱▱▱▱▱▱▱▱ 10%\n" +
    "▰▰▰▰▱▱▱▱▱▱ 50%\n" +
    "▰▰▰▰▰▰▰▰▰▰ 100%\n\n" +
    "📜 نامت بر لبه‌ی صفحه زمزمه می‌شود…\n" +
    "📝 حالا نام کاراکتر خود را بفرست:\n" +
    "(با همان فونتی که در رول پلی استفاده می‌کنی)";

  ctx.session.reg_step = "name";
  ctx.session.reg_clan = clanKey;

  await sendUiPage(ctx, text);
}


// اتمام ثبت‌نام: ذخیره نام + خاندان
async function finishRegistration(ctx: MyContext, name: string) {
  const { supabase } = ctx.services;
  const tgId = ctx.from!.id;
  const clan = ctx.session.reg_clan as ClanKey | null;

  if (!clan) {
    await sendUiPage(
      ctx,
      "خاندان مشخص نشده. دوباره /start بزن تا فرآیند ثبت‌نام از اول شروع شود."
    );
    ctx.session.reg_step = undefined;
    ctx.session.reg_clan = null;
    ctx.session.reg_name = null;
    return;
  }

  const char = await ensureCharacter(ctx);

  const { error: updErr } = await supabase
    .from("characters")
    .update({
      char_name: name,
      clan_name: clan,
    })
    .eq("tg_id", tgId);

  if (updErr) {
    console.error("characters update error (finishRegistration):", updErr);
    await sendUiPage(ctx, "خطایی در ثبت نام رخ داد. بعداً دوباره امتحان کن.");
    return;
  }

  ctx.session.reg_step = undefined;
  ctx.session.reg_clan = null;
  ctx.session.reg_name = null;

  const doneText =
    "✅ ثبت‌نام تو در اطلس باستانی کامل شد.\n\n" +
    `🧬 خون تو: ${labelFromKey(clan)}\n` +
    `📝 نام تو: ${name}\n\n` +
    "از این پس، کتاب مسیرهایت را به خاطر خواهد داشت.";

  await sendUiPage(ctx, doneText);
  await showMainAtlasMenu(ctx);
}

export function registerOnboardingFeature(bot: Bot<MyContext>) {
  // /start — نقطه ورود اصلی بازیکن
  bot.command("start", async (ctx) => {
    if (!ctx.from || ctx.chat?.type !== "private") {
      // ثبت‌نام فقط در PV
      return;
    }

    const char = await ensureCharacter(ctx);

    // اگر هنوز خاندان نداره → ویزارد ثبت‌نام
    if (!char.clan_name) {
      const introText =
        "📜✨ 𝑨𝒓𝒄𝒂𝒏𝒆 𝑨𝒕𝒍𝒂𝒔 — اطلس باستانی سفر\n\n" +
        "کتاب باستانی به لرزه می‌افتد… حروف زرین روی جلد روشن می‌شوند.\n\n" +
        "«مسافر اکلیس… نام تو هنوز بر صفحات من نوشته نشده.»\n\n" +
        "برای آغاز، باید خاندان خود را انتخاب کنی.";

      await sendUiPage(ctx, introText);
      await showClanSelect(ctx);
      return;
    }

    // اگر قبلاً ثبت‌نام شده بود، مستقیم منوی اصلی اطلس
    await showMainAtlasMenu(ctx);
  });

  // انتخاب خاندان با دکمه‌های اینلاین
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    if (!data.startsWith("reg_clan:")) {
      await next();
      return;
    }

    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }

    const key = data.split(":")[1] as ClanKey;
    if (!["Stellarieth", "Walker", "Necroshade", "Torrentress"].includes(key)) {
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.answerCallbackQuery();
    await showClanLoadingAndAskName(ctx, key);
  });

  // گرفتن نام کاراکتر در مرحله‌ی name
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "private") {
      await next();
      return;
    }

    if (ctx.session.reg_step === "name") {
      const name = ctx.message.text.trim();
      if (!name) {
        await sendUiPage(ctx, "نام نمی‌تواند خالی باشد. دوباره بفرست.");
        return;
      }
      await finishRegistration(ctx, name);
      return;
    }

    await next();
  });
}
