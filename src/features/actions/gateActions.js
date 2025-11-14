// src/features/actions/gateActions.js
// رفتار دکمه‌های مسیر (main / sub / micro)
// - main: زمان‌دار + بلیت + لینک join-request + لغو
// - sub : زمان‌دار + بلیت (بدون لینک) + لغو
// - micro: بی‌درنگ و بدون بلیت

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
    if(ctx.chat?.type!=='private') {
      // فقط در PV عمل می‌کنیم
      try { await ctx.answerCbQuery(); } catch {}
      return;
    }

    const tok=`g:${ctx.match[1]}`;
    const payload=getGateToken(tok);
    if(!payload){
      try { await ctx.answerCbQuery('دکمه منقضی است. #ورود را دوباره بزن.'); } catch {}
      return;
    }

    const uid = ctx.from.id;
    const { gate_id } = payload;

    // گیت را از DB بخوان
    const { data: g } = await supa
      .from('gates')
      .select('id,type,from_chat_id,from_page_id,to_chat_id,to_page_id,label,emoji,base_travel_sec,active')
      .eq('id', gate_id)
      .maybeSingle();

    if(!g || g.active===false){
      try { await ctx.answerCbQuery('مسیر در دسترس نیست.'); } catch {}
      return;
    }

    // قفل/ریلِی صفحه مبدا چک شود (اختیاری)
    const relay = await getState(`${g.from_chat_id}`);
    if (relay.locked) {
      try { await ctx.answerCbQuery(relay.lmsg || '⛔️ فعلاً بسته است'); } catch {}
      return;
    }

    // اگر در حال حرکت است، اجازه نده
    const active = await hasActiveMove(uid);
    if (active){
      try { await ctx.answerCbQuery('⏳ در حال حرکت هستی. ابتدا «لغو حرکت» را بزن.'); } catch {}
      return;
    }

    // اعتبار زمانیِ ذخیره‌شده
    const player = await getPlayer(uid);
    const credit = Math.max(0, parseInt(player?.pending_credit_sec || 0, 10) || 0);

    // نوع مسیر
    const isMain  = g.type === 'main';
    const isSub   = g.type === 'sub';
    const isMicro = g.type === 'micro';

    // --- micro: بی‌درنگ
    if (isMicro){
      await upsertPlayer({
        user_id: uid,
        current_chat_id: `${g.to_chat_id || g.from_chat_id}`,
        current_page_id: g.to_page_id,
        status: 'idle',
        updated_at: nowIso()
      });

      // optionally: نمایش عنوان صفحهٔ مقصد
      const page = await getPageById(g.to_page_id);
      try {
        await ctx.editMessageText(`📜 ${page?.title || 'صفحه'}\nحرکت سبک انجام شد.`, Markup.inlineKeyboard([]));
      } catch {
        await ctx.reply(`📜 ${page?.title || 'صفحه'}\nحرکت سبک انجام شد.`);
      }
      try { await ctx.answerCbQuery('✅ انجام شد'); } catch {}
      return;
    }

    // --- main/sub: هر دو «زمان‌دار» ---
    const base = parseInt(g.base_travel_sec || 60, 10);
    const etaSec = Math.max(10, base - credit);  // حداقل 10 ثانیه
    // اعتبار مصرف شد
    if (credit>0) await supa.from('players').update({ pending_credit_sec: 0 }).eq('user_id', uid);

    const depart = nowIso();
    const arrive = new Date(Date.now() + etaSec*1000).toISOString();
    const moveId = `${uid}_${g.id}_${Date.now()}`;

    const cancelTok = putCancelToken({ move_id: moveId, from_chat_id: g.from_chat_id });

    await insertMovement({
      move_id: moveId,
      user_id: uid,
      from_chat_id: `${g.from_chat_id}`,
      to_chat_id: `${isMain ? g.to_chat_id : (g.to_chat_id || g.from_chat_id)}`,
      from_page_id: g.from_page_id,
      to_page_id: g.to_page_id,
      gate_id: g.id,
      state: 'scheduled',
      departed_at: depart,
      arrive_at: arrive
    });

    // بلیت در PV
    const rows = [];

    if (isMain){
      // فقط برای main لینک ورودی لازم است
      try {
        const link = await makeJoinLink(bot, g.to_chat_id);
        if (link?.invite_link) rows.push([Markup.button.url('🚪 ورود به مقصد', link.invite_link)]);
      } catch {}
    }

    rows.push([Markup.button.callback('❌ لغو حرکت', `c:${cancelTok.slice(2)}`)]);

    const title = g.label || (await getPageById(g.to_page_id))?.title || 'مقصد';
    await ctx.reply(
      `🎟️ بلیت حرکت: ${title}\nمدت: ${humanize(etaSec)}\nوقتی زمان رسید، ${
        isMain ? 'روی «ورود به مقصد» بزن.' : 'می‌رسی و صفحهٔ مقصد فعال می‌شود.'
      }`,
      Markup.inlineKeyboard(rows, { columns: 1 })
    );

    try { await ctx.answerCbQuery(`⏳ حرکت شروع شد: ${humanize(etaSec)}`); } catch {}
  });
}

module.exports = { register };
