import { Bot } from "grammy";
import { MyContext } from "../../core/types";
import { supabase } from "../../core/supabase";

/**
 * گرفتن یا ساختن کاراکتر بر اساس telegram_id
 */
async function upsertCharacterByTelegramId(telegramId: number, displayName: string) {
  // ببینیم قبلاً هست یا نه
  const { data: existing, error: selectErr } = await supabase
    .from("characters")
    .select("id")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (selectErr) {
    console.error("upsertCharacterByTelegramId select error", selectErr);
    throw selectErr;
  }

  if (existing) {
    // اگر وجود داشت، فقط display_name و telegram_id رو آپدیت کن
    const { error: updateErr } = await supabase
      .from("characters")
      .update({
        telegram_id: telegramId,
        display_name: displayName,
      })
      .eq("id", existing.id);

    if (updateErr) {
      console.error("upsertCharacterByTelegramId update error", updateErr);
      throw updateErr;
    }

    return existing.id as number;
  }

  // اگر نبود، یه کاراکتر جدید بساز
  const { data: inserted, error: insertErr } = await supabase
    .from("characters")
    .insert({
      telegram_id: telegramId,
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
 * اون شخص رو تو جدول characters ثبت / آپدیت می‌کنه
 */
async function handleRegPlayer(ctx: MyContext) {
  if (!ctx.chat || ctx.chat.type === "private") {
    await ctx.reply("این دستور را باید داخل گروه و روی ریپلای یک پیام استفاده کنی.");
    return;
  }

  const reply = ctx.msg?.reply_to_message;
  if (!reply || !reply.from) {
    await ctx.reply("برای ثبت پلیر باید روی پیام شخص مورد نظر ریپلای کنی.");
    return;
  }

  const target = reply.from;

  // این‌جا بعداً می‌تونیم محدودش کنیم فقط ارباب/ادمین بتونه این دستور رو بزند
  // فعلاً باز می‌گذاریم برای تست.

  const displayName = target.first_name
    ? `${target.first_name}${target.last_name ? " " + target.last_name : ""}`
    : target.username
    ? `@${target.username}`
    : `${target.id}`;

  try {
    const charId = await upsertCharacterByTelegramId(target.id, displayName);

    await ctx.reply(
      `✅ پلیر برای سیستم مسیر ثبت شد.\n\n` +
        `کاراکتر: ${displayName}\n` +
        `telegram_id: ${target.id}\n` +
        `character_id: ${charId}\n\n` +
        `از این به بعد این پلیر برای /path و /arrive قابل شناسایی است.`
    );
  } catch (e) {
    await ctx.reply("در ثبت پلیر برای سیستم مسیر مشکلی پیش آمد. لاگ سرور را چک کن.");
  }
}

/**
 * /whoami – هرکس ببینه در جدول characters چی ذخیره شده
 */
async function handleWhoAmI(ctx: MyContext) {
  if (!ctx.from) {
    await ctx.reply("هویت تلگرام مشخص نیست.");
    return;
  }

  const { data, error } = await supabase
    .from("characters")
    .select("id, display_name, current_region_id, current_spot_id, movement_mode")
    .eq("telegram_id", ctx.from.id)
    .maybeSingle();

  if (error) {
    console.error("whoami select error", error);
    await ctx.reply("در واکشی اطلاعات کاراکتر مشکلی پیش آمد.");
    return;
  }

  if (!data) {
    await ctx.reply("تو هنوز برای سیستم مسیر ثبت نشده‌ای. ادمین باید /regplayer روی پیامت بزند.");
    return;
  }

  const d = data as {
    id: number;
    display_name: string | null;
    current_region_id: string | null;
    current_spot_id: string | null;
    movement_mode: string | null;
  };

  await ctx.reply(
    `🧾 اطلاعات کاراکتر تو (سیستم مسیر):\n\n` +
      `ID: ${d.id}\n` +
      `نام نمایشی: ${d.display_name || "ثبت نشده"}\n` +
      `region_id: ${d.current_region_id || "نامشخص"}\n` +
      `spot_id: ${d.current_spot_id || "نامشخص"}\n` +
      `حالت حرکت: ${d.movement_mode || "walk"}`
  );
}

/**
 * رجیستر فیچر characters روی بات
 */
export function registerWorldCharactersFeature(bot: Bot<MyContext>) {
  bot.command("regplayer", handleRegPlayer);
  bot.command("whoami", handleWhoAmI);
}
