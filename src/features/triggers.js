const { supa } = require('../infra/supabase');
const { Markup } = require('telegraf');
const { firstPage } = require('../services/pageService');
const { buildPageViewForUser } = require('./helpers/pageUi');
const { isAllowed } = require('../services/moderationService');
const { safeSend } = require('../infra/queue');

let ME_USERNAME = null;

function hasVorud(text=''){
  const t = String(text||'').replace(/\u200c/g,'').trim();
  // با یا بدون #
  return /^#?\s*ورود(\s|$)/i.test(t);
}

async function sendPV(bot,userId,chatId){
  // بازیاب وضعیت و صفحه
  const { data:player } = await supa.from('players').select('user_id,current_chat_id,current_page_id').eq('user_id',userId).maybeSingle();
  let pageId=null;

  if(player && `${player.current_chat_id}`===`${chatId}` && player.current_page_id){
    pageId=player.current_page_id;
  } else {
    const first = await firstPage(chatId);
    if(!first) return { ok:false, reason:'no_page' };
    pageId=first.id;
    await supa.from('players').upsert({
      user_id:userId, current_chat_id:`${chatId}`, current_page_id:pageId,
      status:'idle', updated_at:new Date().toISOString()
    }, { onConflict:'user_id' });
  }

  const view = await buildPageViewForUser(chatId,pageId);
  if(!view) return { ok:false, reason:'no_page_view' };

  try { await safeSend(bot,userId,view.text,view.kb); return { ok:true }; }
  catch { return { ok:false, reason:'dm_fail' }; }
}

async function hintIfNeeded(bot,ctx,reason){
  if(!ME_USERNAME) return;
  if(reason!=='dm_fail') return; // فقط وقتی DM واقعاً شکست خورد
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const url=`https://t.me/${ME_USERNAME}?start=start-${chatId}`;
  const extra=Markup.inlineKeyboard([[Markup.button.url('📥 باز کردن پی‌وی ربات',url)]]);
  try{
    const m = await safeSend(bot, chatId, 'برای دریافت مسیرها، یک‌بار به پی‌وی من برو و /start بزن.', extra);
    setTimeout(()=>{ ctx.deleteMessage(m.message_id).catch(()=>{}); }, 6000);
  }catch{}
}

function register(bot, me){
  ME_USERNAME = me.username;

  bot.on('text', async (ctx, next)=>{
    if(ctx.chat?.type==='private') return next();
    const t = ctx.message?.text || '';
    if(hasVorud(t)) return handleVorud(bot,ctx);
    if(/^#?\s*خروج(\s|$)/.test(t)) return handleKhoroj(ctx);
    return next();
  });

  bot.command(['vorud','enter'], async (ctx)=>{
    if(ctx.chat?.type==='private') return;
    return handleVorud(bot,ctx);
  });
}

async function handleVorud(bot,ctx){
  const chatId = `${ctx.chat.id}`; const userId = ctx.from.id;
  const allowed = await isAllowed(chatId); if(!allowed) return;
  const res = await sendPV(bot,userId,chatId);
  if(!res.ok) await hintIfNeeded(bot,ctx,res.reason);
}

async function handleKhoroj(ctx){
  const u=ctx.message?.from; if(!u||u.is_bot) return;
  try{ await ctx.reply(`🧭┊سفر به سلامت ${u.first_name||''}`,{ reply_to_message_id: ctx.message.message_id }); }catch{}
}

module.exports = { register };
