const { getGateToken, putCancelToken } = require('../../utils/tokens');
const { hasActiveMove, insertMovement } = require('../../services/movementService');
const { getPooledJoinRequestLink } = require('../../infra/invitePool');
const { humanize } = require('../../utils/text');

function register(bot){
  bot.action(/^g:([A-Za-z0-9_-]{6,18})$/i, async (ctx)=>{
    if (ctx.chat?.type !== 'private') return ctx.answerCbQuery().catch(()=>{});
    const tok = `g:${ctx.match[1]}`;
    const payload = getGateToken(tok);
    if (!payload) return ctx.answerCbQuery('منقضی شده').catch(()=>{});

    const uid = ctx.from.id;
    const active = await hasActiveMove(uid);
    if (active) return ctx.answerCbQuery('در حال حرکت هستید').catch(()=>{});

    const eta = Math.max(0, Number(payload.eta_sec || 0));
    const rec = await insertMovement({
      user_id: uid,
      from_chat_id: payload.from_chat_id,
      from_page_id: payload.from_page_id,
      to_chat_id: payload.to_chat_id,
      to_page_id: payload.to_page_id,
      gate_id: payload.gate_id,
      eta_sec: eta
    });

    const cancelTok = putCancelToken({ move_id: rec.move_id, from_chat_id: payload.from_chat_id });
    const cancelBtn = [{ text: 'لغو حرکت', callback_data: `c:${cancelTok.slice(2)}` }];

    let text = '🧭 حرکت ثبت شد.';
    if (eta > 0) text += `\n⏳ مدت مسیر: ${humanize(eta)}.`;
    try {
      const link = await getPooledJoinRequestLink(bot, payload.to_chat_id);
      text += `\n\n📥 درخواست عضویت را از این لینک بفرستید: ${link.invite_link || link}`;
    } catch {}

    try { await ctx.answerCbQuery('ثبت شد').catch(()=>{}); } catch {}
    return ctx.reply(text, { reply_markup: { inline_keyboard: [cancelBtn] } });
  });
}

module.exports = { register };
