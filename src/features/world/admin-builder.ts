import type { EclisContext } from "../../core/bot.js";
import { supabase } from "../../core/supabase.js";
import { InlineKeyboard } from "grammy";
import { isOwner, rejectNonOwner } from "../../core/bot.js";

// /worldadmin
export async function handleWorldAdminCommand(ctx: EclisContext) {
  if (!isOwner(ctx)) return rejectNonOwner(ctx);
  if (!ctx.chat) return;

  // پاک کردن دستور در گروه
  try {
    if (ctx.chat.type !== "private" && ctx.msg) {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.msg.message_id);
    }
  } catch {
    // اشکالی ندارد
  }

  const kb = new InlineKeyboard()
    .text("➕ ثبت این گروه به‌عنوان Spot", "wa:create_spot")
    .row()
    .text("📍 لیست Spotها", "wa:list_spots");

  await ctx.reply("🌐 پنل مدیریت جهان اکلیس", { reply_markup: kb });
}

// callback_query های wa:
export async function handleWorldAdminCallback(ctx: EclisContext) {
  if (!isOwner(ctx)) return rejectNonOwner(ctx);
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  if (data === "wa:create_spot") {
    await ctx.answerCallbackQuery();
    return createSpotFromCurrentGroup(ctx);
  }

  if (data === "wa:list_spots") {
    await ctx.answerCallbackQuery();
    return listSpots(ctx);
  }
}

// ثبت همین گروه به عنوان Spot
async function createSpotFromCurrentGroup(ctx: EclisContext) {
  const chat = ctx.chat;
  if (!chat || chat.type === "private") {
    return ctx.reply(
      "این دکمه باید در همان گروهی استفاده شود که می‌خواهی Spot آن باشد.",
    );
  }

  const chatId = String(chat.id);
  const title = chat.title || `Spot ${chatId}`;

  const { data, error } = await supabase
    .from("world_spots")
    .insert({
      title,
      region_id: "default_region",
      chat_id: chatId,
    })
    .select()
    .single();

  if (error || !data) {
    console.error(error);
    return ctx.reply("🚫 خطا در ذخیرهٔ Spot در پایگاه‌داده.");
  }

  await ctx.reply(
    `✅ Spot جدید ساخته شد.\n\nنام: ${data.title}\nRegion: ${data.region_id}\nChatId: \`${data.chat_id}\``,
    { parse_mode: "Markdown" },
  );
}

// لیست Spotها
async function listSpots(ctx: EclisContext) {
  const { data, error } = await supabase
    .from("world_spots")
    .select("id, title, region_id, chat_id")
    .limit(30);

  if (error || !data) {
    console.error(error);
    return ctx.reply("⚠️ در بازیابی Spotها خطایی رخ داد.");
  }

  if (!data.length) {
    return ctx.reply("هنوز هیچ Spotی ثبت نشده.");
  }

  const lines = data.map(
    (s: any) =>
      `• ${s.title} — \`${s.id}\`\n  ریجن: ${s.region_id} | چت: \`${s.chat_id}\``,
  );

  await ctx.reply("📍 Spotهای ثبت‌شده:\n\n" + lines.join("\n"), {
    parse_mode: "Markdown",
  });
}
