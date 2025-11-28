import { Bot } from "grammy";
import { MyContext } from "../../core/types";
import { supabase } from "../../core/supabase";

/**
 * گرفتن یا ساختن کاراکتر بر اساس tg_id (همون user id تلگرام)
 */
async function upsertCharacterByTelegramId(telegramId: number, displayName: string) {
  // ببینیم قبلاً هست یا نه
  const { data: existing, error: selectErr } = await supabase
    .from("characters")
    .select("id")
    .eq("tg_id", telegramId)
    .maybeSingle();

  if (selectErr) {
    console.error("upsertCharacterByTelegramId select error", selectErr);
    throw selectErr;
  }

  if (existing) {
    const { error: updateErr } = await supabase
      .from("characters")
      .update({
        tg_id: telegramId,
        display_name: displayName,
      })
      .eq("id", existing.id);

    if (updateErr) {
      console.error("upsertCharacterByTelegramId update error", updateErr);
      throw updateErr;
    }

    return existing.id as number;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("characters")
    .insert({
      tg_id: telegramId,
      display_name: displayName,
      movement_mode: "walk",
      travel_state: "idle",
    })
    .select("id")
    .maybeSingle();

  if (insertErr) {
    console.error("upsertCharacterByTelegramId insert error", insertErr);
    throw insertErr;
  }

  return inserted?.id as number;
}

/**
 * /regplayer – فقط وقتی روی پیام کسی ریپلای بشه
 * اون شخص رو تو جدول characters ثبت / آپدیت می‌کند.
 */
async function handleRegPlayer(ctx: MyContext) {
  if (!ctx.chat || ctx.chat.type === "private") {
    await ctx.reply("این ورد را باید داخل گروه و روی ریپلای یک پیام استفاده کنی.");
    return;
  }

  const reply = ctx.msg?.reply_to_message;
  if (!reply || !reply.from) {
    await ctx.reply("برای مهر کردن نام یک نفر در دفتر راه‌ها، باید روی پیامش ریپلای کنی.");
    return;
  }

  const target = reply.from;

  const displayName = target.first_name
    ? `${target.first_name}${target.last_name ? " " + target.last_name : ""}`
    : target.username
    ? `@${target.username}`
    : `${target.id}`;

  try {
    const charId = await upsertCharacterByTelegramId(target.id, displayName);

    await ctx.reply(
      `✅ نام این روح در نقشه راه‌های اکلیس ثبت شد.\n\n` +
        `👤 کاراکتر: ${displayName}\n` +
        `🧾 شناسه مسیر: ${charId}\n\n` +
        `از این به بعد، این نفر می‌تواند از جادوی «مسیر های من» و سفر بین نقاط استفاده کند.`
    );
  } catch (e) {
    await ctx.reply(
      "⚠️ رشته‌ای از سرنوشت گیر کرد و ثبت انجام نشد.\n" +
        "چند لحظه بعد دوباره امتحان کن، و اگر تکرار شد، ارباب جهان لاگ‌ها را چک کند."
    );
  }
}

/**
 * /whoami – فقط برای دیباگ خودت، متنت فانتزی اما بدون ستون‌های عجیب
 */
async function handleWhoAmI(ctx: MyContext) {
  if (!ctx.from) {
    await ctx.reply("روح تو را تشخیص نمی‌دهم.");
    return;
  }

  const { data, error } = await supabase
    .from("characters")
    .select("id, display_name, movement_mode")
    .eq("tg_id", ctx.from.id)
    .maybeSingle();

  if (error) {
    console.error("whoami select error", error);
    await ctx.reply("در خواندن دفتر اسامی مشکلی پیش آمد.");
    return;
  }

  if (!data) {
    await ctx.reply("نامت هنوز در دفتر راه‌ها نوشته نشده. ادمین باید روی پیامت /regplayer بزند.");
    return;
  }

  const d = data as {
    id: number;
    display_name: string | null;
    movement_mode: string | null;
  };

  await ctx.reply(
    `🧾 شناسنامه مسیر تو:\n\n` +
      `🔹 ID: ${d.id}\n` +
      `🔹 نام: ${d.display_name || "نام‌گذاری نشده"}\n` +
      `🔹 حالت حرکت فعلی: ${d.movement_mode || "walk"}`
  );
}

/**
 * رجیستر فیچر characters روی بات
 */
export function registerWorldCharactersFeature(bot: Bot<MyContext>) {
  bot.command("regplayer", handleRegPlayer);
  bot.command("whoami", handleWhoAmI);
}
