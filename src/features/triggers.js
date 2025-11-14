// src/features/triggers.js
const { isTrigger } = require('../utils/text');
const { isAllowed } = require('../services/moderationService');
const { firstPage } = require('../services/pageService');
const { buildPageViewForUser } = require('./helpers/pageUi');
const { supa } = require('../infra/supabase');
const { canDMUser, ephemeralNotice, safeDelete } = require('./helpers/telegram');

let ME_USERNAME = null;

async function sendCurrentPagePV(bot, userId, chatId) {
  // اگر نمی‌توانیم پیام خصوصی بفرستیم، همین اول بدانیم
  const dmOk = await canDMUser(bot, userId);
  if (!dmOk) return { ok: false, reason: 'no_dm' };

  // انتخاب/ثبت صفحهٔ فعلی
  const { data: player } = await supa
    .from('players')
    .select('user_id,current_chat_id,current_page_id')
    .eq('user_id', userId)
    .maybeSingle();

  let pageId = null;
  if (player && `${player.current_chat_id}` === `${chatId}` && player.current_page_id) {
    pageId = player.current_page_id;
  } else {
    const first = await firstPage(chatId);
    if (!first) return { ok: false, reason: 'no_page' };
    pageId = first.id;
    await supa
      .from('players')
      .upsert(
        {
          user_id: userId,
          current_chat_id: `${chatId}`,
          current_page_id: pageId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
  }

  // ساخت و ارسال منو
  const view = await buildPageViewForUser(chatId, pageId);
  if (!view) return { ok: false, reason: 'no_view' };

  await bot.telegram.sendMessage(userId, view.text, view.kb);
  return { ok: true };
}

async function deepLink(bot) {
  try {
    const me = await bot.telegram.getMe();
    ME_USERNAME = me.username || ME_USERNAME;
  } catch (_) {}
  return ME_USERNAME ? `https://t.me/${ME_USERNAME}?start=hi` : null;
}

async function handleVorud(bot, ctx) {
  const chatId = `${ctx.chat?.id}`;
  const userId = ctx.from?.id;
  if (!chatId || !userId) return;

  const allowed = await isAllowed(chatId);
  if (!allowed) return;

  // تلاش برای منوی PV
  let result;
  try {
    result = await sendCurrentPagePV(bot, userId, chatId);
  } catch (e) {
    result = { ok: false, reason: 'internal' };
  }

  if (result.ok) {
    // اگر پیام موفقیت PV هم می‌خواهی در گروه نده (بدون اسپم). فقط یک تیک پاک‌کردن پیام کاربر:
    try {
      if (ctx.message?.message_id)
        await safeDelete(ctx, chatId, ctx.message.message_id);
    } catch (_) {}
    return;
  }

  // دلایل را دقیق هندل کن
  if (result.reason === 'no_page' || result.reason === 'no_view') {
    // صفحه‌ای در این گروه تعریف نشده: پیام کوتاه، نامحسوس و خودپاک‌شونده
    await ephemeralNotice(
      ctx,
      chatId,
      '⚠️ هنوز صفحه‌ای برای این منطقه تعریف نشده. ادمین می‌تواند با /link_wizard در پی‌وی بسازد.',
      4500
    );
    return;
  }

  if (result.reason === 'no_dm') {
    // فقط اینجا لینک Start بده
    const url = await deepLink(bot);
    const hint =
      url
        ? `برای شروع، یک بار به پی‌وی من پیام بده 👋\n${url}`
        : 'برای شروع، یک بار به پی‌وی من پیام بده 👋';
    await ephemeralNotice(ctx, chatId, hint, 5000);
    return;
  }

  // خطای داخلی
  await ephemeralNotice(ctx, chatId, 'مشکلی پیش آمد. کمی بعد دوباره #ورود را بزن.', 4000);
}

async function handleKhoroj(ctx) {
  const u = ctx.message?.from;
  if (!u || u.is_bot) return;
  try {
    await ctx.reply(`🧭┊سفر به سلامت ${u.first_name || ''}`, {
      reply_to_message_id: ctx.message.message_id,
      disable_notification: true,
    });
  } catch (_) {}
}

function register(bot) {
  (async () => {
    try {
      ME_USERNAME = (await bot.telegram.getMe()).username;
    } catch (_) {}
  })();

  bot.on('message', async (ctx, next) => {
    try {
      const t = ctx.message?.text || '';
      const isGroup = ctx.chat?.type?.endsWith('group');
      if (isGroup && isTrigger(t, 'ورود')) return handleVorud(bot, ctx);
      if (isGroup && isTrigger(t, 'خروج')) return handleKhoroj(ctx);
    } catch (_) {}
    return next();
  });
}

module.exports = { register };
