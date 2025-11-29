// src/features/world/travel.ts

import { Context, InlineKeyboard } from "grammy";
import { supabase } from "../../core/supabase";

/**
 * یک Spot از جهان
 */
interface WorldSpot {
  id: number;
  title: string;
  chat_id: string;
  description: string | null;
}

/**
 * یک Edge از Spot فعلی
 */
interface WorldEdgeWithTarget {
  id: number;
  base_seconds: number;
  to_spot: {
    id: number;
    title: string;
  };
}

/**
 * نمایش لوکیشن فعلی کاراکتر (صرفاً PV)
 * در آینده با جدول characters واقعی اکلیس وصل می‌کنیم.
 */
export async function showCurrentLocation(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) {
    return ctx.reply("هویت کاربر مشخص نیست.");
  }

  // اینجا باید از جدول characters، Spot فعلی را بخوانیم
  // فعلاً فقط به عنوان اسکلت:
  const { data: character, error: charErr } = await supabase
    .from("characters")
    .select("current_spot_id")
    .eq("user_id", userId)
    .single();

  if (charErr || !character || !character.current_spot_id) {
    await ctx.reply(
      "برای تو هنوز موقعیت ثبت نشده. ارباب باید از پنل مدیریت جهان، نقطه‌ی شروع را ثبت کند."
    );
    return;
  }

  const spotId = character.current_spot_id;

  const { data: spot, error: spotErr } = await supabase
    .from("world_spots")
    .select("*")
    .eq("id", spotId)
    .single();

  if (spotErr || !spot) {
    await ctx.reply("نقطه‌ی فعلی در پایگاه داده پیدا نشد.");
    return;
  }

  const textLines = [
    "📍 موقعیت فعلی تو:",
    "",
    `• ${spot.title}`,
    spot.description ? `\n${spot.description}` : "",
    "",
    "می‌تونی از گزینه‌های بعدی برای دیدن مسیرهای خروجی استفاده کنی.",
  ];

  await ctx.reply(textLines.join("\n"));
}

/**
 * نمایش مسیرهای خروجی (Edgeها) از Spot فعلی کاراکتر
 * این تابع فقط Edgeها رو لیست می‌کنه و دکمه می‌سازه،
 * هنوز خودِ «شروع سفر» رو پیاده نکردیم.
 */
export async function showAvailablePaths(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) {
    return ctx.reply("هویت کاربر مشخص نیست.");
  }

  const { data: character, error: charErr } = await supabase
    .from("characters")
    .select("current_spot_id")
    .eq("user_id", userId)
    .single();

  if (charErr || !character || !character.current_spot_id) {
    await ctx.reply(
      "برای تو هنوز موقعیت ثبت نشده. ارباب باید از پنل مدیریت جهان، نقطه‌ی شروع را ست کند."
    );
    return;
  }

  const spotId = character.current_spot_id;

  // Edgeهایی که از این Spot شروع می‌شوند به همراه مقصدشان
  const { data: edges, error: edgeErr } = await supabase
    .from("world_edges")
    .select(
      `
      id,
      base_seconds,
      to_spot:to_spot_id (
        id,
        title
      )
    `
    )
    .eq("from_spot_id", spotId);

  if (edgeErr) {
    await ctx.reply("در هنگام خواندن مسیرها خطایی رخ داد.");
    return;
  }

  if (!edges || edges.length === 0) {
    await ctx.reply("از این نقطه هیچ مسیری تعریف نشده است.");
    return;
  }

  const kb = new InlineKeyboard();

  for (const edge of edges as WorldEdgeWithTarget[]) {
    const label = `→ ${edge.to_spot.title} (${edge.base_seconds} ثانیه پیاده)`;
    kb.text(label, `travel:start:${edge.id}`).row();
  }

  await ctx.reply("مسیرهای خروجی از موقعیت فعلی:", {
    reply_markup: kb,
  });
}

/**
 * اسکلت هندلر Callback برای شروع سفر.
 * فعلاً فقط پیام می‌فرسته که «سفر آینده اینجا پیاده می‌شود».
 * بعداً با سیستم زمان‌دار کاملش می‌کنیم.
 */
export async function handleTravelCallback(ctx: Context) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  if (!data.startsWith("travel:start:")) return;

  const parts = data.split(":");
  const edgeId = Number(parts[2]);

  if (!edgeId) {
    await ctx.answerCallbackQuery({ text: "شناسه‌ی مسیر نامعتبر است." });
    return;
  }

  await ctx.answerCallbackQuery();

  // در نسخه‌های بعدی:
  // 1) Edge را از DB می‌خوانیم
  // 2) مدت سفر را حساب می‌کنیم بر اساس movement_mode
  // 3) travel_state را در DB ثبت می‌کنیم
  // 4) بعد از زمان مشخص، لینک گروه مقصد را می‌فرستیم و از گروه قبلی کیک می‌کنیم
  await ctx.reply(
    [
      "🚶‍♂️ شروع سفر از این نقطه ثبت شد.",
      "در نسخه‌ی بعدی، این دکمه واقعاً تو را در جهان جابه‌جا می‌کند.",
    ].join("\n")
  );
}
