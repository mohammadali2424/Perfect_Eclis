const { supa } = require('../infra/supabase');
const { Markup } = require('telegraf');
const { firstPage } = require('../services/pageService');
const { buildPageViewForUser } = require('./helpers/pageUi');
const { isAllowed } = require('../services/moderationService');
const { safeSend } = require('../infra/queue');

let ME_USERNAME = null;

function normalize(text = '') {
  return String(text || '')
    .replace(/\u200c/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// هم #ورود و هم #start
function isStartTag(text = '') {
  const n = normalize(text);
  return /^#?\s*(ورود|start)(\s|$)/i.test(n);
}

function isKhoroj(text = '') {
  return /^#?\s*خروج(\s|$)/i.test(normalize(text));
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

// ارسال منوی صفحه به PV
async function sendPVMenu(bot, userId, chatId) {
  try {
    const { data: player } = await supa
      .from('players')
      .select('user_id,current_chat_id,current_page_id')
      .eq('user_id', userId)
      .maybeSingle();

    let pageId = null;

    if (
      player &&
      `${player.current_chat_id}` === `${chatId}` &&
      player.current_page_id
    ) {
      pageId = player.current_page_id;
    } else {
      const first = await firstPage(chatId);
      if (!first) {
        // هیچ صفحه‌ای برای این گروه تنظیم نشده
        return { ok: false, reason: 'no_page' };
      }
      pageId = first.id;

      await supa.from('players').upsert(
        {
          user_id: userId,
          current_chat_id: `${chatId}`,
          current_page_id: pageId,
          status: 'idle',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    }

    const view = await buildPageViewForUser(chatId, pageId);
    if (!view) {
      // صفحه هست ولی خروجی UI مشکل دارد / گیت ندارد
      return { ok: false, reason: 'no_page_view' };
    }

    await safeSend(bot, userId, view.text, view.kb);
    return { ok: true };
  } catch (e) {
    console.error('sendPVMenu error:', e);
    return { ok: false, reason: 'dm_fail' }; // هر چیزی شدنی نشد → شبیه PV بسته
  }
}

async function hintDM(bot, ctx) {
  await ensureMe(bot);
  if (!ME_USERNAME) return;

  const url = `https://t.me/${ME_USERNAME}?start=start-${ctx.chat.id}`;
  const extra = Markup.inlineKeyboard([
    [Markup.button.url('📥 باز کردن پی‌وی ربات', url)],
  ]);

  try {
    const m = await ctx.reply(
      'برای دریافت مسیرها، یک‌بار به پی‌وی من برو و /start بزن.',
      extra,
    );
    setTimeout(() => {
      ctx.deleteMessage(m.message_id).catch(() => {});
    }, 6000);
  } catch {}
}

function register(bot) {
  ensureMe(bot).catch(() => {});

  bot.on('text', async (ctx, next) => {
    // PV → به ما ربطی ندارد، بقیه‌ی هندلرها ادامه بدهند
    if (ctx.chat?.type === 'private') return next();

    const t = ctx.message?.text || '';

    if (isStartTag(t)) {
      return handleVorud(bot, ctx);
    }
    if (isKhoroj(t)) {
      return handleKhoroj(ctx);
    }

    return next();
  });
}

async function handleVorud(bot, ctx) {
  const chatId = `${ctx.chat.id}`;

  const allowed = await isAllowed(chatId);
  if (!allowed) return;

  const userId = ctx.from.id;
  const res = await sendPVMenu(bot, userId, chatId);

  if (res.ok) return;

  // بسته به دلیل، پیام مناسب بده
  if (res.reason === 'dm_fail') {
    // PV بسته یا خطای ارسال → لینک پی‌وی بده
    await hintDM(bot, ctx);
  } else if (res.reason === 'no_page') {
    // هیچ صفحه‌ای برای این گروه ثبت نشده
    try {
      await ctx.reply(
        'برای این گروه هنوز هیچ صفحه‌ای ثبت نشده.\n' +
          'اول باید در پی‌وی با دستورهای /lw_page و /lw_gate برای این گروه صفحه و مسیر بسازی.',
      );
    } catch {}
  } else if (res.reason === 'no_page_view') {
    // صفحه وجود دارد ولی گیت/خروجی UI مشکل دارد
    try {
      await ctx.reply(
        'صفحه برای این گروه ثبت شده ولی مسیری برای نمایش وجود ندارد.\n' +
          'گیت‌ها را با /lw_gate تنظیم کن تا دکمه‌های مسیر ظاهر شوند.',
      );
    } catch {}
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
