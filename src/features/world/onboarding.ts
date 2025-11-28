// src/features/world/onboarding.ts
import type { EclisContext } from "../../core/bot.js";
import { showMainMenu, setMovementMode } from "../../core/bot.js";
import { InlineKeyboard } from "grammy";
import { supabase } from "../../core/supabase.js";

// اگر ClanId رو جایی تعریف نکردی، اینو همون‌جا بذار تو core/types.ts
// ولی اینجا لوکال دوباره تعریف می‌کنیم که قطعی کار کنه
type ClanId = "walker" | "stellarieth" | "necroshade" | "torrentress";

interface Player {
  id: string;
  telegram_id: number;
  username: string | null;
  full_name: string | null;
  clan: ClanId | null;
}

// --- کیبورد انتخاب خاندان ---

const CLAN_BUTTONS = new InlineKeyboard()
  .text("⚡ 𝑾𝒂𝒍𝒌𝒆𝒓", "onboard:clan:walker")
  .row()
  .text("🪽 𝑺𝒕𝒆𝒍𝒍𝒂𝒓𝒊𝒆𝒕𝒉", "onboard:clan:stellarieth")
  .row()
  .text("🖤 𝑵𝒆𝒄𝒓𝒐𝒔𝒉𝒂𝒅𝒆", "onboard:clan:necroshade")
  .row()
  .text("🔥 𝑻𝒐𝒓𝒓𝒆𝒏𝒕𝒓𝒆𝒔𝒔", "onboard:clan:torrentress");

// --- /start ---

export async function handleStart(ctx: EclisContext) {
  if (!ctx.from) return;

  // اگر توی گروه زد، راهنمایش کن بیاد PV
  if (ctx.chat?.type !== "private") {
    return ctx.reply("برای شروع سفر در اکلیس، به پی‌وی من بیا و /start بزن.");
  }

  const tgId = ctx.from.id;

  // چک کنیم پلیر قبلاً وجود داره یا نه
  let player: Player | null = null;

  try {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("telegram_id", tgId)
      .maybeSingle();

    if (error) {
      console.error("Supabase players select error:", error);
    }
    player = (data as Player) ?? null;
  } catch (e) {
    console.error("Supabase players select exception:", e);
  }

  if (!player) {
    // پلیر جدید → معرفی جهان + انتخاب خاندان
    await ctx.reply(
      "✨ به اکلیس خوش آمدی.\n\n" +
        "اینجا دنیاییه که چهار خاندان روی لبه‌ی تعادل راه می‌رن.\n" +
        "اول بگو خونت به کدومشون نزدیک‌تره:",
      { reply_markup: CLAN_BUTTONS },
    );
    return;
  } else if (!player.clan) {
    // پلیر هست ولی خاندان نداره
    await ctx.reply(
      "تو از قبل توی دفتر ثبت اکلیس هستی، اما هنوز زیر پرچم هیچ خاندانی نرفتی.\n" +
        "خاندان خودت رو انتخاب کن:",
      { reply_markup: CLAN_BUTTONS },
    );
    return;
  } else {
    // پلیر کامل ثبت شده → فقط سلام و منو
    const name =
      player.full_name ||
      player.username ||
      (ctx.from.first_name ?? "مسافر");
    await ctx.reply(`دوباره برگشتی، ${name}.\nسفرت رو از کجا ادامه می‌دی؟`);
    await showMainMenu(ctx);
    return;
  }
}

// --- هندلر callback برای انتخاب خاندان ---

export async function handleOnboardingCallback(ctx: EclisContext) {
  if (!ctx.callbackQuery?.data) return;
  const data = ctx.callbackQuery.data;

  if (!data.startsWith("onboard:")) {
    // این callback برای ما نیست
    return;
  }

  await ctx.answerCallbackQuery().catch(() => undefined);

  const parts = data.split(":"); // ["onboard", "clan", "<id>"]
  const action = parts[1];

  if (action !== "clan") return;

  const clan = parts[2] as ClanId;
  if (
    clan !== "walker" &&
    clan !== "stellarieth" &&
    clan !== "necroshade" &&
    clan !== "torrentress"
  ) {
    return ctx.reply("این خاندان معتبر نیست.");
  }

  if (!ctx.from) return;

  const tgId = ctx.from.id;
  const username = ctx.from.username ?? null;
  const fullName =
    [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") ||
    null;

  try {
    // upsert بر اساس telegram_id
    const { data, error } = await supabase
      .from("players")
      .upsert(
        {
          telegram_id: tgId,
          username,
          full_name: fullName,
          clan,
        },
        { onConflict: "telegram_id" },
      )
      .select()
      .single();

    if (error) {
      console.error("Supabase players upsert error:", error);
      return ctx.reply("در ثبت اطلاعاتت مشکلی پیش اومد. یه کم بعد دوباره امتحان کن.");
    }

    const player = data as Player;

    // برای آینده، می‌تونیم همین‌جا player_locations بسازیم اگر وجود نداره
    try {
      await supabase
        .from("player_locations")
        .insert({
          player_id: player.id,
          movement_mode: "walk",
        })
        .onConflict("player_id")
        .ignore();
    } catch (e) {
      console.error("Supabase player_locations insert error:", e);
    }

    // پیام قبلی رو ادیت کنیم که خوشگل باشه
    try {
      await ctx.editMessageText(
        `✅ ثبت شد.\n\nتو حالا رسماً عضو خاندان ${
          clan === "walker"
            ? "⚡ 𝑾𝒂𝒍𝒌𝒆𝒓"
            : clan === "stellarieth"
            ? "🪽 𝑺𝒕𝒆𝒍𝒍𝒂𝒓𝒊𝒆𝒕𝒉"
            : clan === "necroshade"
            ? "🖤 𝑵𝒆𝒄𝒓𝒐𝒔𝒉𝒂𝒅𝒆"
            : "🔥 𝑻𝒐𝒓𝒓𝒆𝒏𝒕𝒓𝒆𝒔𝒔"
        } شدی.`,
      );
    } catch {
      // اگر نتونست ادیت کنه، حداقل ریپلای کنیم
      await ctx.reply(
        "✅ ثبت شد. خاندان انتخاب شد و روحت به دفتر اکلیس وصل شد.",
      );
    }

    // حالت اولیه حرکت
    await setMovementMode(ctx, "walk");

    // نمایش منوی اصلی
    await showMainMenu(ctx);
  } catch (e) {
    console.error("Onboarding exception:", e);
    return ctx.reply("یه جای کار خطا خورد. دوباره تلاش کن، یا لاگ‌هارو چک کن.");
  }
}

// --- منوی متنی (دکمه‌های پایین پی‌وی) ---

export async function handleMainMenuText(ctx: EclisContext) {
  const txt = ctx.message?.text;
  if (!txt) return;

  if (txt === "🚶 حالت پیاده") {
    await setMovementMode(ctx, "walk");
    return;
  }
  if (txt === "🐎 حالت سوارکار") {
    await setMovementMode(ctx, "ride");
    return;
  }
  if (txt === "🚗 حالت راننده") {
    await setMovementMode(ctx, "drive");
    return;
  }
  if (txt === "🎈 حمل و نقل") {
    await setMovementMode(ctx, "transport");
    return;
  }

  if (txt === "🧭 مسیرهای من") {
    // اینجا بعداً لیست مسیرها / لوکیشن فعلی رو می‌چسبونیم
    await ctx.reply("هنوز سیستم مسیرهای شخصی‌ات رو نچسبوندیم. به‌زودی اضافه می‌شه.");
    return;
  }

  if (txt === "🗺 نقشهٔ سریع من") {
    // وقتی لوکیشن واقعی وصل شد اینجا لوکیشن رو نشون می‌دیم
    await ctx.reply("به‌زودی، اینجا لوکیشن دقیق شخصیتت روی نقشه اکلیس نمایش داده می‌شه.");
    return;
  }
}
