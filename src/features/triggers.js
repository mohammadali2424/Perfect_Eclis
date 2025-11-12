const { isTrigger } = require('../utils/text');
const { isAllowed } = require('../services/moderationService');
const { firstPage } = require('../services/pageService');
const { buildPageViewForUser } = require('./helpers/pageUi');
const { supa } = require('../infra/supabase');
const { safeSend } = require('../infra/queue');
const { Markup } = require('telegraf');

let ME_USERNAME=null;

async function sendCurrentPagePV(bot,userId,chatId){
  const { data:player } = await supa.from('players').select('user_id,current_chat_id,current_page_id').eq('user_id',userId).maybeSingle();
  let pageId=null;
  if(player && `${player.current_chat_id}`===`${chatId}` && player.current_page_id){ pageId=player.current_page_id; }
  else { const first=await firstPage(chatId); if(!first) return false; pageId=first.id; await supa.from('players').upsert({user_id:userId,current_chat_id:`${chatId}`,current_page_id:pageId,status:'idle',updated_at:new Date().toISOString()},{onConflict:'user_id'}); }
  const view=await buildPageViewForUser(chatId,pageId); if(!view) return false;
  await safeSend(bot,userId,view.text,view.kb); return true;
}
async function sendStartHintInGroup(bot,chatId,userId,replyToMsgId){
  if(!ME_USERNAME) return;
  const url=`https://t.me/${ME_USERNAME}?start=start-${chatId}`;
  const extra={ reply_to_message_id: replyToMsgId, ...Markup.inlineKeyboard([[Markup.button.url('📥 باز کردن پی‌وی ربات',url)]])};
  try{ const m=await safeSend(bot,chatId,'برای دریافت مسیرها، یک‌بار به پی‌وی من برو و /start بزن.',extra); setTimeout(async()=>{ try{ await bot.telegram.deleteMessage(chatId,m.message_id);}catch{} },8000);}catch{}
}

function register(bot,me){ ME_USERNAME=me.username;
  bot.on('text', async (ctx,next)=>{
    if(ctx.chat?.type==='private') return next();
    const t=ctx.message?.text||'';
    if(isTrigger(t,'ورود')) return handleVorud(bot,ctx);
    if(isTrigger(t,'خروج')) return handleKhoroj(ctx);
    return next();
  });
  bot.command(['vorud','enter'], async (ctx)=>{
    if(ctx.chat?.type==='private') return;
    return handleVorud(bot,ctx);
  });
}
async function handleVorud(bot,ctx){
  const chatId=`${ctx.chat?.id}`; const userId=ctx.from?.id;
  if(!chatId||!userId) return;
  const allowed=await isAllowed(chatId); if(!allowed) return;
  try{ const ok=await sendCurrentPagePV(bot,userId,chatId); if(!ok) throw new Error('no_view'); }
  catch(e){ await sendStartHintInGroup(bot,chatId,userId,ctx.message?.message_id); }
}
async function handleKhoroj(ctx){
  const u=ctx.message?.from; if(!u||u.is_bot) return;
  try{ await ctx.reply(`🧭┊سفر به سلامت ${u.first_name||''}`,{ reply_to_message_id: ctx.message.message_id }); }catch{}
}

module.exports = { register };
