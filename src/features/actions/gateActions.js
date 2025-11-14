// src/features/actions/gateActions.js
const { getGateToken, putCancelToken } = require('../../utils/tokens');
const { hasActiveMove, insertMovement } = require('../../services/movementService');
const { getPageById } = require('../../services/pageService');
const { upsertPlayer, getPlayer } = require('../../domain/repositories/playersRepo');
const { makeJoinLink } = require('../../services/inviteService');
const { humanize } = require('../../utils/text');
const { Markup } = require('telegraf');
const { supa } = require('../../infra/supabase');
const { getState } = require('../../services/moderationService');

function nowIso(){ return new Date().toISOString(); }

function register(bot){
  bot.action(/^g:([A-Za-z0-9_-]{6,32})$/i, async (ctx)=>{
    if(ctx.chat?.type!=='private') return ctx.answerCbQuery().catch(()=>{});
    const tok=`g:${ctx.match[1]}`; const payload=getGateToken(tok); if(!payload) return ctx.answerCbQuery('دکمه منقضی است. #ورود را بزن.').catch(()=>{});
    const { gate_id, type:gtype, eta:baseEta } = payload; const uid=ctx.from.id;

    const { data:g } = await supa.from('gates').select('id,type,from_chat_id,from_page_id,to_chat_id,to_page_id,label,emoji,base_travel_sec').eq('id',gate_id).maybeSingle();
    if(!g) return ctx.answerCbQuery('مسیر نامعتبر').catch(()=>{});
    const st=await getState(`${g.from_chat_id}`); if(st.locked) return ctx.answerCbQuery(st.lmsg||'⛔️ منطقه قفل است').catch(()=>{});

    const active=await hasActiveMove(uid); if(active){ return ctx.answerCbQuery('⏳ در حال حرکت هستی. ابتدا «لغو حرکت» را بزن.').catch(()=>{}); }

    const player=await getPlayer(uid); const credit=Math.max(0,parseInt(player?.pending_credit_sec||0,10)||0);
    const etaSec=Math.max(10,(parseInt(baseEta,10)||(g.base_travel_sec||60))-credit);
    if(credit>0) await supa.from('players').update({pending_credit_sec:0}).eq('user_id',uid);

    const depart=nowIso(); const arrive=new Date(Date.now()+etaSec*1000).toISOString(); const moveId=`${uid}_${gate_id}_${Date.now()}`;

    if(gtype==='sub'){
      await upsertPlayer({ user_id:uid, current_chat_id:`${g.to_chat_id}`, current_page_id:g.to_page_id, status:'idle', updated_at:nowIso() });
      const page=await getPageById(g.to_page_id);
      await ctx.editMessageText(`📜 ${page?.title||'صفحه'}\nحرکت سبک انجام شد.`, Markup.inlineKeyboard([])).catch(async()=>{
        await ctx.reply(`📜 ${page?.title||'صفحه'}\nحرکت سبک انجام شد.`);
      });
      return ctx.answerCbQuery().catch(()=>{});
    }

    // main or micro treated as timed movement (micro buttons handled elsewhere but we keep generality)
    const cancelTok = putCancelToken({ move_id: moveId, from_chat_id: g.from_chat_id });

    // Insert movement
    await insertMovement({
      move_id: moveId,
      user_id: uid,
      from_chat_id: `${g.from_chat_id}`,
      to_chat_id: `${g.to_chat_id}`,
      from_page_id: g.from_page_id,
      to_page_id: g.to_page_id,
      gate_id: g.id,
      state: 'scheduled',
      departed_at: depart,
      arrive_at: arrive
    });

    // send ticket
    let ticketText = `🎟️ بلیت حرکت: ${g.label || ''}\nمدت: ${humanize(etaSec)}\nوقتی رسید، روی «ورود به مقصد» بزن.`;
    const rows = [];
    try {
      const link = await makeJoinLink(bot, g.to_chat_id);
      if (link && link.invite_link) {
        rows.push([Markup.button.url('🚪 ورود به مقصد', link.invite_link)]);
      }
    } catch {}
    rows.push([Markup.button.callback('❌ لغو حرکت', `c:${cancelTok.slice(2)}`)]);
    await ctx.reply(ticketText, Markup.inlineKeyboard(rows, { columns: 1 }));

    return ctx.answerCbQuery(`⏳ حرکت شروع شد: ${humanize(etaSec)}`).catch(()=>{});
  });
}
module.exports = { register };