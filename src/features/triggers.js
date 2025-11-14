// src/features/triggers.js
const { isTrigger } = require('../utils/text');
const { isAllowed } = require('../services/moderationService');
const { firstPage } = require('../services/pageService');
const { buildPageViewForUser } = require('./helpers/pageUi');
const { supa } = require('../infra/supabase');
const { safeSend } = require('../infra/queue');
const { Markup } = require('telegraf');

let ME_USERNAME = null;

async function sendCurrentPagePV(bot, userId, chatId) {
  const { data: player } = await supa.from('players').select('user_id,current_chat_id,current_page_id').eq('user_id', userId).maybeSingle();
  let pageId = null;
  if (player && `${player.current_chat_id}` === `${chatId}` && player.current_page_id) {
    pageId = player.current_page_id;
  } else {
    const first = await firstPage(chatId);
    if (!first) return false;
    pageId = first.id;
    await supa.from('players').upsert({ user_id: userId, current_chat_id: `${chatId}`, current_page_id: pageId, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  }
  const view = await buildPageViewForUser(chatId, pageId); if (!view) return false;
  try { await bot.telegram.sendMessage(userId, view.text, view.kb); } catch { return false; }
  return true;
}

async function sendStartHintInGroup(bot, chatId, userId, replyTo) {
  const me = ME_USERNAME || (await bot.telegram.getMe()); ME_USERNAME = me.username || ME_USERNAME;
  const url = `https://t.me/${ME_USERNAME}?start=hi`;
  try {
    await bot.telegram.sendMessage(chatId, `برای شروع، به پی‌وی من پیام بده 👋\n${url}`, { reply_to_message_id: replyTo, disable_web_page_preview: true });
  } catch {}
}

async function handleVorud(bot, ctx) {
  const chatId = `${ctx.chat?.id}`; const userId = ctx.from?.id;
  if (!chatId || !userId) return;
  const allowed = await isAllowed(chatId); if (!allowed) return;
  try {
    const ok = await sendCurrentPagePV(bot, userId, chatId);
    if (!ok) throw new Error('no_view');
  } catch (e) {
    await sendStartHintInGroup(bot, chatId, userId, ctx.message?.message_id);
  }
}

async function handleKhoroj(ctx) {
  const u = ctx.message?.from; if (!u || u.is_bot) return;
  try { await ctx.reply(`🧭┊سفر به سلامت ${u.first_name || ''}`, { reply_to_message_id: ctx.message.message_id }); } catch {}
}

function register(bot, me) {
  ME_USERNAME = me.username;
  bot.on('message', async (ctx, next) => {
    try {
      const t = ctx.message?.text || '';
      if (ctx.chat?.type?.endsWith('group') && isTrigger(t, 'ورود')) return handleVorud(bot, ctx);
      if (ctx.chat?.type?.endsWith('group') && isTrigger(t, 'خروج')) return handleKhoroj(ctx);
    } catch {}
    return next();
  });
}

module.exports = { register };