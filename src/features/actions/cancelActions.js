// src/features/actions/cancelActions.js
const { getCancelToken } = require('../../utils/tokens');
const { cancelMove } = require('../../domain/repositories/movementsRepo');
const { supa } = require('../../infra/supabase');
const { humanize } = require('../../utils/text');

function register(bot){
  bot.action(/^c:([A-Za-z0-9_-]{6,32})$/i, async (ctx)=>{
    if(ctx.chat?.type!=='private') return ctx.answerCbQuery().catch(()=>{});
    const tok=`c:${ctx.match[1]}`; const payload=getCancelToken(tok); if(!payload) return ctx.answerCbQuery('منقضی').catch(()=>{});
    const { move_id, from_chat_id } = payload; const uid=ctx.from.id;

    const { data } = await supa
      .from('movements').select('move_id,departed_at,arrive_at')
      .eq('move_id', move_id).eq('user_id', uid).eq('state','scheduled').maybeSingle();
    if(!data) return ctx.answerCbQuery('حرکتی برای لغو نیست').catch(()=>{});

    const elapsedSec=Math.max(0, Math.round((Date.now()-new Date(data.departed_at).getTime())/1000));
    await cancelMove(move_id);
    await supa.from('players').upsert({user_id:uid,pending_credit_sec: elapsedSec, updated_at:new Date().toISOString(), current_chat_id:`${from_chat_id}`},{onConflict:'user_id'});
    await ctx.answerCbQuery('لغو شد').catch(()=>{});
    return ctx.reply(`✋ حرکت لغو شد. اعتبار مسیر: ${humanize(elapsedSec)}`);
  });
}
module.exports = { register };