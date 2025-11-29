// src/features/world/admin-builder.ts

import { Context, InlineKeyboard } from "grammy";
import { supabase } from "../../core/supabase";

/**
 * نوع Spot در جهان اکلیس
 */
export interface WorldSpot {
  id: number;
  title: string;
  chat_id: string; // آیدی گروه / چت مربوط به این نقطه
  description: string | null;
}

/**
 * نوع Edge بین دو Spot
 */
export interface WorldEdge {
  id: number;
  from_spot_id: number;
  to_spot_id: number;
  base_seconds: number;
  can_walk: boolean;
  can_ride: boolean;
  can_drive: boolean;
}

/**
 * پنل ساده برای نمایش وضعیت جهان یک گروه
 * (در آینده می‌تونیم این رو به /worldadmin وصل کنیم)
 */
export async function showWorldAdminPanel(ctx: Context) {
  if (!ctx.chat) {
    return ctx.reply("این دستور فقط داخل یک چت معتبر قابل استفاده است.");
  }

  const chatId = String(ctx.chat.id);

  // تعداد Spot و Edge مربوط به این چت
  const { data: spots, error: spotErr } = await supabase
    .from("world_spots")
    .select("id")
    .eq("chat_id", chatId);

  const { data: edges, error: edgeErr } = await supabase
    .from("world_edges")
    .select("id")
    .eq("from_chat_id", chatId);

  const spotsCount = spotErr || !spots ? 0 : spots.length;
  const edgesCount = edgeErr || !edges ? 0 : edges.length;

  const kb = new InlineKeyboard()
    .text("➕ ساخت Spot در این چت", "worldadmin:create_spot")
    .row()
    .text("🌐 رفرش وضعیت", "worldadmin:refresh");

  await ctx.reply(
    [
      "🗺️ پنل مدیریت جهان برای این چت:",
      "",
      `• تعداد Spot ثبت‌شده در این چت: ${spotsCount}`,
      `• تعداد Edge که از این چت شروع می‌شوند: ${edgesCount}`,
      "",
      "برای ساخت Spot جدید یا رفرش، از دکمه‌های زیر استفاده کن.",
    ].join("\n"),
    { reply_markup: kb }
  );
}

/**
 * هندلر کلیک روی دکمه‌های پنل worldadmin
 * (باید در bot.ts با bot.on('callback_query:data', ...) صدا زده شود)
 */
export async function handleWorldAdminCallback(ctx: Context) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  if (!ctx.chat) {
    await ctx.answerCallbackQuery({ text: "چت نامعتبر است." });
    return;
  }

  const chatId = String(ctx.chat.id);

  if (data === "worldadmin:refresh") {
    await ctx.answerCallbackQuery();
    // پیام جدید وضعیت
    await showWorldAdminPanel(ctx);
    return;
  }

  if (data === "worldadmin:create_spot") {
    await ctx.answerCallbackQuery();
    await createSpotForChat(ctx, chatId);
    return;
  }
}

/**
 * ساخت یک Spot ساده برای این چت
 * فعلاً به صورت خودکار یک Spot "ورود به این چت" می‌سازد اگر قبلاً وجود نداشته باشد.
 */
async function createSpotForChat(ctx: Context, chatId: string) {
  // چک کنیم آیا قبلاً Spotی برای این چت ثبت شده یا نه
  const { data: existing, error } = await supabase
    .from("world_spots")
    .select("*")
    .eq("chat_id", chatId)
    .limit(1);

  if (error) {
    await ctx.reply("در هنگام بررسی Spotها خطایی رخ داد.");
    return;
  }

  if (existing && existing.length > 0) {
    await ctx.reply("برای این چت قبلاً حداقل یک Spot ثبت شده است.");
    return;
  }

  const title =
    ctx.chat?.title || ctx.chat?.id?.toString() || "Unnamed Location";

  const { data: inserted, error: insertErr } = await supabase
    .from("world_spots")
    .insert({
      chat_id: chatId,
      title: title,
      description: "نقطه‌ی ورود به این چت",
    })
    .select()
    .single();

  if (insertErr || !inserted) {
    await ctx.reply("در هنگام ساخت Spot خطایی رخ داد.");
    return;
  }

  await ctx.reply(
    [
      "✅ یک Spot جدید برای این چت ثبت شد.",
      "",
      `• شناسه: ${inserted.id}`,
      `• عنوان: ${inserted.title}`,
    ].join("\n")
  );
}
