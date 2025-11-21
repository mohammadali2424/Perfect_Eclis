const { isTrigger } = require('../utils/text');
const { isAllowed } = require('../services/moderationService');
const { firstPage } = require('../services/pageService');
const { buildPageViewForUser } = require('./helpers/pageUi');
const { supa } = require('../infra/supabase');
const { safeSend } = require('../infra/queue');
const { Markup } = require('telegraf');

let ME_USERNAME = null;

async function ensureMe(bot){
  if (ME_USERNAME) return ME_USERNAME;
  try {
    const me = await bot.telegram.getMe();
    ME_USERNAME = me.username;
  } catch { ME_USERNAME = null; }
  return ME_USERNAME;
}

async function sendStartHintInGroup(bot, chatId, userId, replyToMsgId){
  const me = await ensureMe(bot);
  if (!me) return;
  const url = `https://t.me/${me}?start=start-${chatId}`;
  const extra = { reply_to_message_id: replyToMsgId, ...Markup.inlineKeyboard([
    [Markup.button.url('📥 باز کردن پی‌وی ربات', url)]
  ])};
  try {
    await safeSend(bot, chatId, 'برای ادامه، ربات را در پی‌وی باز کنید:', extra);
  } catch {}
}

async function sendCurrentPagePV(bot, userId, chatId){
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

  const view = await buildPageViewForUser(chatId, pageId);
  if (!view) return false;

  try {
    await bot.telegram.sendMessage(userId, view.text, { reply_markup: view.kb.reply_markup });
  } catch {
    return false;
  }
  return true;
}

function register(bot){
  bot.on('message', async (ctx) => {
    const t = ctx.message?.text || '';
    if (ctx.chat?.type === 'private') return; // PM را استارت هندل می‌کند
    if (!isTrigger(t)) return;
    return sendStartHintInGroup(bot, `${ctx.chat.id}`, ctx.from?.id, ctx.message?.message_id);
  });

  bot.start(async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    const arg = (ctx.startPayload || '').trim();
    const m = /^start-(\-?\d{6,20})$/.exec(arg);
    const chatId = m ? m[1] : null;
    if (!chatId) return ctx.reply('سلام! از داخل گروه لینک را بزنید تا سفر شروع شود.');

    const allowed = await isAllowed(chatId);
    if (!allowed) return ctx.reply('این گروه مجاز نیست.');

    const ok = await sendCurrentPagePV(bot, ctx.from.id, chatId);
    if (!ok) return ctx.reply('صفحه‌ای پیدا نشد.');
  });
}

module.exports = { register };
