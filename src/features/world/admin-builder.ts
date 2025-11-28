import type { EclisContext } from "../../core/bot.js";
import { supabase } from "../../core/supabase.js";
import { InlineKeyboard } from "grammy";
import { isOwner, rejectNonOwner } from "../../core/bot.js";

// جدول‌ها:
// world_regions (id, name)
// world_spots   (id, title, region_id, chat_id, is_spawn)
// world_edges   (id, from_spot_id, to_spot_id, base_travel_seconds,
//                can_walk, can_ride, can_drive, can_transport)

// پنل اصلی مدیریت جهان
export async function handleWorldAdminCommand(ctx: EclisContext) {
  if (!isOwner(ctx)) return rejectNonOwner(ctx);

  if (!ctx.chat || ctx.chat.type === "private") {
    return ctx.reply("این دستور باید داخل گروهی که می‌خواهی به‌عنوان Spot ثبت شود زده شود.");
  }

  // پیام دستور را پاک کن تا تمیز بماند
  try {
    await ctx.api.deleteMessage(ctx.chat.id, ctx.msg!.message_id);
  } catch (_) {}

  const kb = new InlineKeyboard()
    .text("➕ ثبت این گروه به‌عنوان Spot", "wa:create_spot")
    .row()
    .text("🧩 مدیریت Spotها", "wa:list_spots")
    .row()
    .text("🛣 ساخت Edge بین Spotها", "wa:start_edge");

  await ctx.api.sendMessage(
    ctx.from!.id,
    "🌐 پنل مدیریت جهان اکلیس

برای این گروه می‌تونی Spot بسازی یا بین Spotهای موجود Edge تعریف کنی.",
    { reply_markup: kb }
  );
}

// هندلر callbackهای مربوط به world admin
export async function handleWorldAdminCallback(ctx: EclisContext) {
  if (!isOwner(ctx)) return rejectNonOwner(ctx);
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  if (data === "wa:create_spot") {
    return createSpotFromLinkedGroup(ctx);
  }

  if (data === "wa:list_spots") {
    return listSpotsForOwner(ctx);
  }

  if (data === "wa:start_edge") {
    return startEdgeWizard(ctx);
  }
}

// ساخت Spot از آخرین گروهی که /worldadmin در آن زده شده
async function createSpotFromLinkedGroup(ctx: EclisContext) {
  const userId = ctx.from!.id;

  // فرض ساده: آخرین گروهی که از آن worldadmin زده‌ایم همان گروه فعلی context نیست،
  // پس کاربر باید خودش id، region و title را دستی وارد کند.
  // برای ساده‌سازی MVP، فقط یک Spot جدید در یک region پیش‌فرض می‌سازیم.

  await ctx.answerCallbackQuery();
  await ctx.reply(
    "🧱 ساخت Spot جدید

" +
      "در نسخه فعلی، برای سادگی یک Spot با Region پیش‌فرض ساخته می‌شود.
" +
      "در ادامه می‌توانیم ویرایش Region و نام نمایشی را اضافه کنیم."
  );

  const chat = ctx.chat;
  if (!chat) return;

  const chatId = chat.id.toString();
  const title = chat.title ?? `Spot ${chatId}`;

  const { data, error } = await supabase
    .from("world_spots")
    .insert({
      title,
      region_id: "default_region",
      chat_id: chatId
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return ctx.reply("🚫 خطا در ذخیره Spot در پایگاه‌داده.");
  }

  await ctx.reply(
    `✅ Spot جدید ساخته شد.

` +
      `نام: ${data.title}
` +
      `Region: ${data.region_id}
` +
      `Chat: \`${data.chat_id}\``,
    { parse_mode: "Markdown" }
  );
}

// نمایش خلاصه‌ای از Spotهای موجود
async function listSpotsForOwner(ctx: EclisContext) {
  await ctx.answerCallbackQuery();

  const { data, error } = await supabase
    .from("world_spots")
    .select("id, title, region_id, chat_id")
    .limit(20);

  if (error) {
    console.error(error);
    return ctx.reply("⚠️ در بازیابی Spotها خطایی رخ داد.");
  }

  if (!data || data.length === 0) {
    return ctx.reply("هیچ Spotی هنوز ثبت نشده.");
  }

  const lines = data.map(
    (s: any) => `• ${s.title} — \`${s.id}\`
  ریجن: ${s.region_id} | چت: \`${s.chat_id}\``
  );

  await ctx.reply("📍 Spotهای ثبت‌شده:

" + lines.join("
"), {
    parse_mode: "Markdown"
  });
}

// شروع ویزارد ساخت Edge
async function startEdgeWizard(ctx: EclisContext) {
  await ctx.answerCallbackQuery();
  ctx.session.worldBuilderMode = "create_edge";
  ctx.session.worldBuilderPayload = {};

  await ctx.reply(
    "🛣 ساخت Edge بین دو Spot

" +
      "ابتدا ID Spot مبدأ را بفرست.
" +
      "بعد از آن ID مقصد و در نهایت زمان پایه سفر (ثانیه) را."
  );
}
