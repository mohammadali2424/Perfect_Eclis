const { getGateToken } = require('../../utils/tokens');
const { hasActiveMove, insertMovement } = require('../../services/movementService');
const { getPageById } = require('../../services/pageService');
const { upsertPlayer, getPlayer } = require('../../domain/repositories/playersRepo');
const { makeJoinLink } = require('../../services/inviteService');
const { humanize, mention } = require('../../utils/text');
const { Markup } = require('telegraf');
const { supa } = require('../../infra/supabase');
const { getState } = require('../../services/moderationService');
const { safeSend } = require('../../infra/queue');

function nowIso(){ return new Date().toISOString(); }

async function sendFootprint(bot, fromChatId, uid, label){
  try{
    const fp = await safeSend(bot, fromChatId, `👣 ردِ پای ${mention(uid)} به سمت «${label}»`, { parse_mode:'Markdown' });
    setTimeout(()=>{ bot.telegram.deleteMessage(fromChatId, fp.message_id).catch(()=>{}); }, 120000); // 2 دقیقه
  }catch{}
}

function register(bot){
  bot.action(/^g:([A-Za-z0-9_-]{6,18})$/i, async (ctx)=>{
    const tok=`g:${ctx.match[1]}`; const payload=require('../../utils/cache').cbMap.get(tok);
    if(!payload) return ctx.answerCbQuery('دکمه منقضی است. #ورود را بزن.').catch(()=>{});
    const { gate_id } = payload; const uid=ctx.from.id;

    const { data:g } = await supa.from('gates').select('id,type,from_chat_id,from_page_id,to_chat_id,to_page_id,label,base_travel_sec').eq('id',gate_id).maybeSingle();
    if(!g) return ctx.answerCbQuery('مسیر نامعتبر').catch(()=>{});
    const st=await getState(`${g.from_chat_id}`); if(st.locked) return ctx.answerCbQuery(st.lmsg||'⛔️ منطقه قفل است').catch(()=>{});
    const active=await hasActiveMove(uid); if(active){ return ctx.answerCbQuery('⏳ در حال حرکت هستی. ابتدا «لغو حرکت» را بزن.').catch(()=>{}); }

    const player=await getPlayer(uid); const credit=Math.max(0,parseInt(player?.pending_credit_sec||0,10)||0);
    const etaSec=Math.max(10,(parseInt(g.base_travel_sec,10)||60)-credit);
    if(credit>0) await supa.from('players').update({pending_credit_sec:0}).eq('user_id',uid);

    const depart=nowIso(); const arrive=new Date(Date.now()+etaSec*1000).toISOString(); const moveId=`${uid}_${gate_id}_${Date.now()}`;

    // ردپا در مبدا (هم برای main هم sub)
    await sendFootprint(ctx.telegram, `${g.from_chat_id}`, uid, g.label);

    if(g.type==='sub'){
      await upsertPlayer({ user_id:uid, current_chat_id:`${g.to_chat_id}`, current_page_id:g.from_page_id, status:'quarantined', updated_at:depart });
      await insertMovement({ move_id:moveId, user_id:uid, from_chat_id:`${g.from_chat_id}`, to_chat_id:`${g.to_chat_id}`, from_page_id:g.from_page_id, to_page_id:g.to_page_id, gate_id: gate_id, departed_at:depart, arrive_at:arrive, state:'scheduled', invite_link:null, ticket_expires_at:null });
      await ctx.answerCbQuery('حرکتت ثبت شد').catch(()=>{});
      const destPage=await getPageById(g.to_page_id);
      return ctx.reply(`شما درحال حرکت هستی…\n\nمسیر شما به سمت «${destPage?.title||'مقصد'}» است.\nمدت مسیر: ${humanize(etaSec)}`,
        Markup.inlineKeyboard([[Markup.button.callback('❌ لغو حرکت',`c:${require('../../utils/tokens').putCancelToken({ move_id: moveId, from_chat_id: `${g.from_chat_id}` }).slice(2)}`)]]));
    }

    // main (با Join Request)
    let pooled; try{ pooled=await makeJoinLink(global.bot,g.to_chat_id);}catch(e){ return ctx.answerCbQuery('🚫 ایجاد لینک ممکن نشد (ادمین/Join Request)').catch(()=>{}); }
    await upsertPlayer({ user_id:uid, current_chat_id:`${g.to_chat_id}`, current_page_id:g.from_page_id, status:'quarantined', updated_at:depart });
    await insertMovement({ move_id:moveId, user_id:uid, from_chat_id:`${g.from_chat_id}`, to_chat_id:`${g.to_chat_id}`, from_page_id:g.from_page_id, to_page_id:g.to_page_id, gate_id: gate_id, departed_at:depart, arrive_at:arrive, state:'scheduled', invite_link:null, ticket_expires_at:new Date(Date.now()+5*60*1000).toISOString() });

    const destPage=await getPageById(g.to_page_id);
    await ctx.answerCbQuery('بلیت در PV ارسال شد').catch(()=>{});
    return ctx.telegram.sendMessage(uid,
      `شما درحال حرکت هستی…\n\nمسیر شما به سمت «${destPage?.title||'مقصد'}» است.\nمدت مسیر: ${humanize(etaSec)}\n\nوقتی به زمان مقرر رسیدی، روی دکمه بزن:`,
      Markup.inlineKeyboard([
        [Markup.button.url('ورود به مقصد', pooled.invite_link)],
        [Markup.button.callback('❌ لغو حرکت',`c:${require('../../utils/tokens').putCancelToken({ move_id: moveId, from_chat_id: `${g.from_chat_id}` }).slice(2)}`)]
      ])
    );
  });
}
module.exports = { register };
