// src/features/actions/navActions.js
const { buildPageViewForUser } = require('../helpers/pageUi');
const { humanize } = require('../../utils/text');
const { supa } = require('../../infra/supabase');

function register(bot){
  bot.action(/^pnav:(-?\d{6,20}):(.+)$/i, async (ctx)=>{
    if(ctx.chat?.type!=='private') return ctx.answerCbQuery().catch(()=>{});
    const chatId=ctx.match[1]; const pageId=ctx.match[2];
    const view=await buildPageViewForUser(chatId,pageId);
    if(!view) return ctx.answerCbQuery('صفحه نامعتبر').catch(()=>{});
    try{ await ctx.editMessageText(view.text,view.kb);}catch{ await ctx.reply(view.text,view.kb);}
    await ctx.answerCbQuery().catch(()=>{});
  });
  bot.action('pnav:nop',(ctx)=>ctx.answerCbQuery().catch(()=>{}));
  bot.action('pmenu:eta', async (ctx)=>{
    const uid=ctx.from.id;
    const { data:mv } = await supa
      .from('movements').select('move_id,arrive_at').eq('user_id', uid).eq('state','scheduled')
      .order('departed_at',{ascending:false}).limit(1);
    const m=mv&&mv[0]; if(!m) return ctx.answerCbQuery('حرکتی در جریان نیست').catch(()=>{});
    const d=new Date(m.arrive_at).getTime()-Date.now();
    if(d<=0) return ctx.answerCbQuery('به مقصد رسیدی (یا هر لحظه)').catch(()=>{});
    return ctx.answerCbQuery(`زمان باقی‌مانده: ${humanize(Math.round(d/1000))}`).catch(()=>{});
  });
}
module.exports = { register };