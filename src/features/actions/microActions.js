const { getMicroToken } = require('../../utils/tokens');
const { buildMicroView } = require('../../services/microService');
const { mention } = require('../../utils/text');
const { safeSend } = require('../../infra/queue');
const { getPlayer } = require('../../domain/repositories/playersRepo');

function register(bot){
  bot.action(/^m:([A-Za-z0-9_-]{6,18})$/i, async (ctx)=>{
    if(ctx.chat?.type!=='private') return ctx.answerCbQuery().catch(()=>{});
    const tok=`m:${ctx.match[1]}`; const payload=require('../../utils/cache').cbMap.get(tok); if(!payload) return ctx.answerCbQuery('منقضی است').catch(()=>{});
    const { page_id, next_key, eta } = payload;
    const v=await buildMicroView(page_id, next_key);
    if(!v) return ctx.answerCbQuery('مقصد نامعتبر').catch(()=>{});

    const uid=ctx.from.id; const player=await getPlayer(uid); const chatId=player?.current_chat_id;
    const announce=async()=>{ if(chatId){ try{ await safeSend(bot,chatId,`🎯 پلیر ${mention(uid)} وارد ${v.text.replace(/^📜\s*/,'').trim()} شد`,{parse_mode:'Markdown'}); }catch{} } };

    if(eta && eta>0){ try{ await ctx.answerCbQuery(`⏳ ${eta} ثانیه`, true);}catch{} setTimeout(async()=>{ try{ await ctx.editMessageText(v.text,v.kb);}catch{ await ctx.reply(v.text,v.kb);} await announce(); }, eta*1000); }
    else { try{ await ctx.editMessageText(v.text,v.kb);}catch{ await ctx.reply(v.text,v.kb);} await announce(); }
  });
}
module.exports = { register };
