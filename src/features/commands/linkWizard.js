// src/features/commands/linkWizard.js
const { Markup } = require('telegraf');
const { supa } = require('../../infra/supabase');
const { parseDur, normalize } = require('../../utils/text');
const { requireOwner } = require('../../utils/auth');

function inPV(ctx){ return ctx.chat?.type === 'private'; }

function homeKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ ساخت صفحه (فله‌ای)', 'wz:new_page')],
    [Markup.button.callback('🚪 ساخت مسیر', 'wz:new_gate')],
    [Markup.button.callback('📍 تنظیم گروه مقصد (با فوروارد)', 'wz:set_dest')],
  ], { columns: 1 });
}

async function showHomeToUser(ctxOrBot, userId) {
  const txt = 'جادوگر لینک 🤖 — یکی را انتخاب کن:';
  const tg = ctxOrBot.telegram || ctxOrBot;
  await tg.sendMessage(userId, txt, { reply_markup: homeKb().reply_markup });
}

async function showHome(ctx) {
  return ctx.reply('جادوگر لینک 🤖 — یکی را انتخاب کن:', homeKb());
}

function onlyHomeKb(){ return Markup.inlineKeyboard([[Markup.button.callback('🏠 خانه','wz:home')]],{columns:1}); }

async function askPagesLines(ctx) {
  await ctx.reply('عناوین صفحه‌ها را بفرست؛ *هر خط = یک صفحه*.', { parse_mode:'Markdown', ...onlyHomeKb() });
}
async function handlePagesLines(ctx) {
  const uid = ctx.from.id;
  const { data: p } = await supa.from('players').select('current_chat_id').eq('user_id', uid).maybeSingle();
  if (!p?.current_chat_id) { await ctx.reply('اول در یک گروه #ورود بزن.', onlyHomeKb()); return; }

  const lines = String(ctx.message?.text || '').split(/\r?\n/).map(s => normalize(s).slice(0,100)).filter(Boolean);
  if (!lines.length) return ctx.reply('چیزی نبود!', onlyHomeKb());

  const { data: cur } = await supa.from('pages').select('order_index').eq('chat_id', `${p.current_chat_id}`).order('order_index', { ascending: true });
  let ord = (cur?.[cur.length-1]?.order_index || 0) + 1;
  const rows = lines.map(title => ({ chat_id: `${p.current_chat_id}`, title, order_index: ord++, meta_json: {}, created_at: new Date().toISOString() }));
  const { error } = await supa.from('pages').insert(rows);
  if (error) return ctx.reply('❌ ساخت صفحات شکست خورد.', onlyHomeKb());
  await ctx.reply(`✅ ${rows.length} صفحه ساخته شد.`, homeKb());
}

async function askGateLine(ctx) {
  await ctx.reply(
`ساخت مسیر — یک خط بده: \`key=value\`

نمونه‌ها:
\`type=main from_page=1 to_chat=-100.. to_page=2 label="شهر" emoji=🌿 time=7m\`
\`type=sub  from_page=2 to_page=3 label="بازار" emoji=↪️ time=2m\`
\`type=micro from_page=3 to_page=4 label="فروشگاه" emoji=🪶 time=0\``,
    { parse_mode:'Markdown', ...onlyHomeKb() }
  );
}

async function handleGateLine(ctx) {
  const raw = ctx.message?.text || '';
  const kv = {};
  for (const m of raw.matchAll(/(\w+)=("[^"]+"|'[^']+'|[^\s]+)/g)) {
    const k = m[1].toLowerCase();
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    kv[k]=v;
  }

  const type = (kv.type||'main').toLowerCase();
  const from_page = parseInt(kv.from_page,10);
  const to_page   = kv.to_page?parseInt(kv.to_page,10):null;
  const to_chat   = kv.to_chat?String(kv.to_chat):null;
  const label     = kv.label?String(kv.label).slice(0,64):'';
  const emoji     = kv.emoji?String(kv.emoji).slice(0,8):'';
  const t         = kv.time?parseDur(kv.time):null;

  if (!from_page || !['main','sub','micro'].includes(type)) return ctx.reply('پارامترها نامعتبر.', onlyHomeKb());
  if (type==='main' && (!to_chat || !to_page)) return ctx.reply('برای main → to_chat و to_page لازم است.', onlyHomeKb());
  if ((type==='sub'||type==='micro') && !to_page) return ctx.reply('برای sub/micro → to_page لازم است.', onlyHomeKb());

  const { data: f } = await supa.from('pages').select('id,chat_id').eq('id', from_page).maybeSingle();
  if (!f) return ctx.reply('from_page پیدا نشد.', onlyHomeKb());

  const base = t && t>=0 ? t : 60;
  const insert = {
    type, from_chat_id: `${f.chat_id}`, from_page_id: from_page,
    to_chat_id: type==='main' ? `${to_chat}` : `${f.chat_id}`,
    to_page_id: to_page, label, emoji, base_travel_sec: base, created_at: new Date().toISOString()
  };
  const { error } = await supa.from('gates').insert(insert);
  if (error) return ctx.reply('❌ ساخت مسیر شکست خورد.', onlyHomeKb());
  await ctx.reply('✅ مسیر ساخته شد.', homeKb());
}

// انتخاب مقصد با فوروارد
async function askDestByForward(ctx) {
  ctx.sessionStep = 'dest:forward';
  await ctx.reply('یک پیام از *گروه مقصد* به همین پی‌وی فوروارد کن.', { parse_mode:'Markdown', ...onlyHomeKb() });
}
async function handleDestForward(ctx, state) {
  if (state!== 'dest:forward') return false;
  const ch = ctx.message?.forward_from_chat;
  if (!ch || !(ch.type==='group'||ch.type==='supergroup')) { await ctx.reply('این فوروارد از گروه نیست.', onlyHomeKb()); return true; }
  ctx.wzToChat = { id: `${ch.id}`, title: ch.title || ch.username || `${ch.id}` };
  await ctx.reply(`✅ گروه مقصد: ${ctx.wzToChat.title}`, homeKb());
  ctx.sessionStep = null;
  return true;
}

function register(bot){
  // همهٔ دستورات این فایل فقط مالک: wrapper
  bot.command('link_wizard', async (ctx,next)=> requireOwner(ctx, async()=> {
    if (inPV(ctx)) {
      await showHome(ctx);
    } else {
      try { await ctx.deleteMessage(); } catch {}
      await showHomeToUser(bot, ctx.from.id);
    }
  }));

  bot.action('wz:home', async (ctx)=>{ await requireOwner(ctx, async()=> inPV(ctx) && ctx.answerCbQuery().catch(()=>{}) && showHome(ctx)); });
  bot.action('wz:new_page', async (ctx)=>{ await requireOwner(ctx, async()=> inPV(ctx) && ctx.answerCbQuery().catch(()=>{}) && askPagesLines(ctx)); });
  bot.action('wz:new_gate', async (ctx)=>{ await requireOwner(ctx, async()=> inPV(ctx) && ctx.answerCbQuery().catch(()=>{}) && askGateLine(ctx)); });
  bot.action('wz:set_dest', async (ctx)=>{ await requireOwner(ctx, async()=> inPV(ctx) && ctx.answerCbQuery().catch(()=>{}) && askDestByForward(ctx)); });

  // پیام‌های متنی PV (فوروارد/صفحات/مسیر)
  bot.on('message', async (ctx, next) => {
    if (ctx.chat?.type!=='private') return next();
    // اگر مالک نیست، کاری نکن
    const ok = await new Promise(res => requireOwner(ctx, ()=>res(true)) );
    if (!ok) return;

    // فوروارد مقصد
    if (ctx.message?.forward_from_chat) {
      await handleDestForward(ctx, ctx.sessionStep);
      return;
    }
    // ساخت صفحه فله‌ای
    if (ctx.sessionStep === 'pages:lines') {
      await handlePagesLines(ctx); return;
    }
    // ساخت مسیر تک‌خط
    if (ctx.sessionStep === 'gate:line') {
      await handleGateLine(ctx); return;
    }
    return next();
  });
}

module.exports = { register };
