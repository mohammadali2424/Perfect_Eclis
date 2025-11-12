// src/features/triggers.js
//
// رفتار: هشتگ «#ورود» فقط در گروه‌ها شنود می‌شود و منوی مسیرها را در PV می‌فرستد.
// اگر PV بسته باشد، هیچ اسپمی نمی‌کند؛ فقط در صورت لزوم یک دکمه‌ی بازکردن PV می‌گذارد و حذف می‌کند.
// دستور «#خروج» هم فقط همان پیام خداحافظیِ سبک را ریپلای می‌کند.

const { supa } = require('../infra/supabase');
const { Markup } = require('telegraf');
const { firstPage } = require('../services/pageService');
const { buildPageViewForUser } = require('./helpers/pageUi');
const { isAllowed } = require('../services/moderationService');
const { safeSend } = require('../infra/queue');

let ME_USERNAME = null;

function normalize(text = '') {
  // حذف نیم‌فاصله، فاصله‌های اضافی، و یونی‌کدهای مرسوم
  return String(text || '')
    .replace(/\u200c/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isVorud(text = '') {
  const t = normalize(text);
  // هم با # و هم بدون #، و با/بدون فاصله
  return /^#?\s*ورود(\s|$)/i.test(t);
}

function isKhoroj(text = '') {
  const t = normalize(text);
  return /^#?\s*خروج(\s|$)/i.test(t);
}

async function ensureMe(bot) {
  if (!ME_USERNAME) {
    try {
      const me = await bot.telegram.getMe();
      ME_USERNAME = me.username || null;
    } catch {
      ME_USERNAME = null;
    }
  }
}

async function sendPVMenu(bot, userId, chatId) {
  // تلاش می‌کنیم صفحه‌ی کاربر را پیدا/تنظیم کنیم
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
    await supa.from('players').upsert(
      {
        user_id: userId,
        current_chat_id: `${chatId}`,
        current_page_id: pageId,
        status: 'idle',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  }

  const view = await buildPageViewForUser(chatId, pageId);
  if (!view) return { ok: false, reason: 'no_page_view' };

  try {
    await safeSend(bot, userId, view.text, view.kb);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'dm_fail' };
  }
}

async function hintDM(bot, ctx) {
  // فقط وقتی DM واقعاً بسته است
  await ensureMe(bot);
  if (!ME_USERNAME) return;

  const chatId = ctx.chat.id;
  const url = `https://t.me/${ME_USERNAME}?start=start-${chatId}`;
  const extra = Markup.inlineKeyboard([[Markup.button.url('📥 باز کردن پی‌وی ربات', url)]]);
  try {
    const m = await ctx.reply(
      'برای دریافت مسیرها، یک‌بار به پی‌وی من برو و /start بزن.',
      extra
    );
    setTimeout(() => {
      ctx.deleteMessage(m.message_id).catch(() => {});
    }, 6000);
  } catch {}
}

function register(bot) {
  // اطمینان از کشیدن getMe یک‌بار
  ensureMe(bot).catch(() => {});

  // شنود متن‌ها در گروه‌ها
  bot.on('text', async (ctx, next) => {
    if (ctx.chat?.type === 'private') return next();

    const t = ctx.message?.text || '';
    if (isVorud(t)) return handleVorud(bot, ctx);
    if (isKhoroj(t)) return handleKhoroj(ctx);
    return next();
  });

  // شورتکات معادل #ورود
  bot.command(['vorud', 'enter'], async (ctx) => {
    if (ctx.chat?.type === 'private') return;
    return handleVorud(bot, ctx);
  });
}

async function handleVorud(bot, ctx) {
  // فقط اگر گروه مجاز باشد
  const chatId = `${ctx.chat.id}`;
  const allowed = await isAllowed(chatId);
  if (!allowed) return;

  const userId = ctx.from.id;
  const res = await sendPVMenu(bot, userId, chatId);
  if (!res.ok && res.reason === 'dm_fail') {
    await hintDM(bot, ctx);
  }
}

async function handleKhoroj(ctx) {
  const u = ctx.message?.from;
  if (!u || u.is_bot) return;
  try {
    await ctx.reply(`🧭┊سفر به سلامت ${u.first_name || ''}`, {
      reply_to_message_id: ctx.message.message_id,
    });
  } catch {}
}

module.exports = { register };
