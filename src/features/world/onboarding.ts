import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { MyContext } from "../../core/types";

// فونت‌های فانتزی خاندان‌ها
const CLAN_STELL = "🪽 𝑺𝒕𝒆𝒍𝒍𝒂𝒓𝒊𝒆𝒕𝒉 — تاجداران سپیده‌دم";
const CLAN_WALK = "⚡ 𝑾𝒂𝒍𝒌𝒆𝒓 — وارثان نیرو";
const CLAN_NECRO = "🖤 𝑵𝒆𝒄𝒓𝒐𝒔𝒉𝒂𝒅𝒆 — ندیمان سایه";
const CLAN_TORR = "🔥 𝑻𝒐𝒓𝒓𝒆𝒏𝒕𝒓𝒆𝒔𝒔 — وارثان شعله";

// کلیدهای منطقی (برای ذخیره در دیتابیس)
type ClanKey = "Stellarieth" | "Walker" | "Necroshade" | "Torrentress";

// map برای نمایشی و منطقی
const CLAN_LABELS: Record<ClanKey, string> = {
  Stellarieth: CLAN_STELL,
  Walker: CLAN_WALK,
  Necroshade: CLAN_NECRO,
  Torrentress: CLAN_TORR,
};

function labelFromKey(key: ClanKey): string {
  return CLAN_LABELS[key];
}

// پاک کردن صفحه‌ی قبلی منو در PV
async function deleteUiPage(ctx: MyContext) {
  try {
    if (ctx.chat?.type === "private" && ctx.session.ui_last_menu_id) {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.session.ui_last_menu_id);
    }
  } catch {
    // اگر اجازه نداشت، مهم نیست
  }
  ctx.session.ui_last_menu_id = undefined;
}

// ارسال صفحه‌ی جدید منو + ذخیره‌ی message_id
async function sendUiPage(
  ctx: MyContext,
  text: string,
  extra: Parameters<MyContext["reply"]>[1] = {}
) {
  await deleteUiPage(ctx);
  const msg = await ctx.reply(text, extra);
  ctx.session.ui_last_menu_id = msg.message_id;
}

// ساخت یا گرفتن کاراکتر بر اساس tg_id
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
  const tgId = ctx.from!.id;
  return ensureCharacterFor(ctx, tgId);
}

// صفحه‌ی اصلی Arcane Atlas برای کسی که ثبت‌نام شده
async function showMainAtlasMenu(ctx: MyContext) {
  const char = await ensureCharacter(ctx);

  const clanLabel = char.clan_name
    ? labelFromKey(char.clan_name as ClanKey)
    : "❓ خاندان نامشخص";

  const text =
    "📜✨ 𝑨𝒓𝒄𝒂𝒏𝒆 𝑨𝒕𝒍𝒂𝒔 — اطلس باستانی سفر\n\n" +
    "صفحه‌های تو اکنون روشن‌اند، مسافر اکلیس.\n\n" +
    `🧬 خون تو ثبت شده است:\n${clanLabel}\n\n` +
    "چه می‌خواهی انجام دهی؟";

  const kb = new InlineKeyboard()
    .text("📍 مکان فعلی من", "atlas:where")
    .row()
    .text("🧭 مسیر های من", "atlas:paths")
    .row()
    .text("📜 وضعیت من", "atlas:profile");

  // کیبورد پایینی برای راحتی
  const replyKb = new Keyboard().text("🧭 مسیر های من").resized();

  await sendUiPage(ctx, text, { reply_markup: replyKb });
  // دکمه‌های اینلاین را در یک پیام جدا می‌فرستیم تا تداخلی با کیبورد نداشته باشد
  await ctx.reply("یک گزینه را انتخاب کن:", { reply_markup: kb });
}

// صفحه‌ی انتخاب خاندان
async function showClanSelect(ctx: MyContext) {
  const text =
    "🜂 انتخاب خاندان\n" +
    "-------------------------\n" +
    "پیش از آنکه قدم در مسیر بگذاری، باید خون تو شناخته شود…\n\n" +
    "از کدام خاندانی هستی؟";

  const kb = new InlineKeyboard()
    .text("🪽 𝓢𝓽𝓮𝓵𝓵𝓪𝓻𝓲𝓮𝓽𝓱", "reg_clan:Stellarieth")
    .row()
    .text("⚡ 𝕎𝕒𝕝𝕜𝕖𝕣", "reg_clan:Walker")
    .row()
    .text("🖤 𝕹𝖊𝖈𝖗𝖔𝖘𝖍𝖆𝖉𝖊", "reg_clan:Necroshade")
    .row()
    .text("🔥 𝑻𝒐𝒓𝒓𝒆𝒏𝒕𝒓𝒆𝒔𝒔", "reg_clan:Torrentress");

  ctx.session.reg_step = "clan";
  ctx.session.reg_clan = null;
  ctx.session.reg_name = null;

  await sendUiPage(ctx, text, { reply_markup: kb });
}

// لودینگ بعد از انتخاب خاندان + درخواست نام
async function showClanLoadingAndAskName(ctx: MyContext, clanKey: ClanKey) {
  const label = labelFromKey(clanKey);

  const text =
    "⚙️ در حال سینک کردن خون خاندان…\n" +
    `${label}\n\n` +
    "███▒▒▒▒▒▒▒▒ 30%\n" +
    "██████▒▒▒▒ 60%\n" +
    "██████████ 100%\n\n" +
    "✨ اتصال روح باستانی کامل شد.\n\n" +
    "📝 حالا نام کاراکتر خود را بفرست:\n" +
    "(با همان فونتی که در رول پلی استفاده می‌کنی)";

  ctx.session.reg_step = "name";
  ctx.session.reg_clan = clanKey;

  await sendUiPage(ctx, text);
}

// تکمیل ثبت‌نام با نام و خاندان
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
  // /start — نقطه‌ی ورود اصلی
  bot.command("start", async (ctx) => {
    if (!ctx.from || ctx.chat?.type !== "private") {
      // فقط در PV مهم است
      return;
    }

    const char = await ensureCharacter(ctx);

    // اگر هنوز خاندان ندارد → ثبت نام
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

    // در غیر این صورت، مستقیم وارد منوی اصلی اطلس شود
    await showMainAtlasMenu(ctx);
  });

  // دکمه‌ی پایین «🧭 مسیر های من» اگر کاربر همیشه بخواد مسیرها را ببیند
  bot.hears("🧭 مسیر های من", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    // این فقط منوی اصلی اطلس را بالا می‌آورد، نمایش مسیر واقعی را
    // همچنان همان feature travel.ts انجام می‌دهد.
    await showMainAtlasMenu(ctx);
  });

  // انتخاب خاندان
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

  // گرفتن نام کاراکتر در مرحله‌ی ثبت نام
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
