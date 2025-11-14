// src/features/commands/linkWizard.js
const { Markup } = require('telegraf');
const { supa } = require('../../infra/supabase');
const { parseDur, normalize } = require('../../utils/text');

const wz = new Map(); // state per user
const stOf = (uid) => { if (!wz.has(uid)) wz.set(uid, { step: 0 }); return wz.get(uid); };

function inPV(ctx){ return ctx.chat?.type === 'private'; }
async function ensurePV(bot, ctx, msgIfNeed='برای ادامه، به پی‌وی من پیام بده.') {
  if (inPV(ctx)) return true;
  try { if (ctx.message?.message_id) await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id); } catch {}
  try { await bot.telegram.sendMessage(ctx.from.id, msgIfNeed); } catch {}
  return false;
}

function homeKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ ساخت صفحه', 'wz:new_page')],
    [Markup.button.callback('🚪 ساخت مسیر', 'wz:new_gate')],
    [Markup.button.callback('📍 تنظیم گروه مقصد (با فوروارد)', 'wz:set_dest')],
  ], { columns: 1 });
}

async function showHome(ctx) {
  const s = stOf(ctx.from.id);
  const dest = s.toChatTitle ? `\nگروه مقصد: ${s.toChatTitle}` : '';
  await ctx.reply(`جادوگر لینک 🤖 — انتخاب کن: ${dest}`, homeKb());
}

function onlyHomeKb() { return Markup.inlineKeyboard([[Markup.button.callback('🏠 خانه', 'wz:home')]], { columns: 1 }); }

// ====== صفحه ======
async function askPagesLines(ctx) {
  const s = stOf(ctx.from.id);
  s.step = 'pages:lines';
  await ctx.reply('عناوین صفحه‌ها را بفرست؛ *هر خط = یک صفحه*.\nمثال:\nاتاق ورودی\nبازار\nطویله', { parse_mode: 'Markdown', ...onlyHomeKb() });
}

async function handlePagesLines(ctx) {
  const s = stOf(ctx.from.id);
  if (s.step !== 'pages:lines') return false;

  // گروه مبدا را از players (آخرین #ورود) بخوانیم
  const uid = ctx.from.id;
  const { data: p } = await supa.from('players').select('current_chat_id').eq('user_id', uid).maybeSingle();
  if (!p?.current_chat_id) {
    s.step = 0;
    await ctx.reply('ابتدا در یک گروه #ورود بزن تا گروه فعلی‌ات مشخص شود.', onlyHomeKb());
    return true;
  }

  const lines = String(ctx.message?.text || '')
    .split(/\r?\n/).map(t => normalize(t).slice(0, 100)).filter(Boolean);

  if (!lines.length) { await ctx.reply('چیزی پیدا نشد.', onlyHomeKb()); return true; }

  // order_index را افزایشی بزنیم
  const { data: cur } = await supa.from('pages').select('order_index').eq('chat_id', `${p.current_chat_id}`).order('order_index', { ascending: true });
  let start = (cur?.[cur.length - 1]?.order_index || 0) + 1;

  const rows = lines.map(title => ({
    chat_id: `${p.current_chat_id}`,
    title, order_index: start++, meta_json: {}, created_at: new Date().toISOString()
  }));
  const { error } = await supa.from('pages').insert(rows);
  s.step = 0;
  if (error) return await ctx.reply('❌ ساخت صفحات شکست خورد.', onlyHomeKb());
  await ctx.reply(`✅ ${rows.length} صفحه ساخته شد.`, homeKb());
  return true;
}

// ====== مسیر ======
function gateTimeKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⏱ 30s', 'wz:time:30'), Markup.button.callback('1m', 'wz:time:60'), Markup.button.callback('2m', 'wz:time:120')],
    [Markup.button.callback('5m', 'wz:time:300'), Markup.button.callback('10m', 'wz:time:600')],
    [Markup.button.callback('🏠 خانه', 'wz:home')],
  ], { columns: 3 });
}

async function askGateLine(ctx) {
  const s = stOf(ctx.from.id);
  s.step = 'gate:line';
  await ctx.reply(
`ساخت مسیر — یک خط بده: \`key=value\`

*نمونه‌ها:*
- \`type=main from_page=1 to_chat=-100123 to_page=2 label="دره سبز" emoji=🌿 time=5m\`
- \`type=sub from_page=1 to_page=2 label="اتاق" emoji=↪️ time=30s\`
- \`type=micro from_page=7 to_page=7 label="نگاه کلی" emoji=🪶 time=0\`

می‌تونی زمان رو با دکمه‌ها هم تنظیم کنی:`,
    { parse_mode:'Markdown', ...gateTimeKb() }
  );
}

async function handleGateLine(ctx) {
  const s = stOf(ctx.from.id);
  if (s.step !== 'gate:line') return false;

  const raw = ctx.message?.text || '';
  const kv = {};
  for (const m of raw.matchAll(/(\w+)=("[^"]+"|'[^']+'|[^\s]+)/g)) {
    const k = m[1].toLowerCase();
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    kv[k] = v;
  }

  const type = (kv.type || 'main').toLowerCase(); // main | sub | micro
  const from_page = parseInt(kv.from_page, 10);
  const to_page = kv.to_page ? parseInt(kv.to_page, 10) : null;
  const to_chat = kv.to_chat ? String(kv.to_chat) : null;
  const label = kv.label ? String(kv.label).slice(0, 64) : '';
  const emoji = kv.emoji ? String(kv.emoji).slice(0, 8) : '';
  const t = kv.time ? parseDur(kv.time) : null;

  if (!from_page || !['main','sub','micro'].includes(type)) { await ctx.reply('پارامترها نامعتبرند: type و from_page الزامی‌اند.', onlyHomeKb()); return true; }
  if (type === 'main' && (!to_chat || !to_page)) { await ctx.reply('برای main باید to_chat و to_page بدهی.', onlyHomeKb()); return true; }
  if ((type === 'sub' || type === 'micro') && !to_page) { await ctx.reply('برای sub/micro باید to_page بدهی.', onlyHomeKb()); return true; }

  // from_page → chat_id
  const { data: f } = await supa.from('pages').select('id,chat_id').eq('id', from_page).maybeSingle();
  if (!f) { await ctx.reply('from_page پیدا نشد.', onlyHomeKb()); return true; }

  const base_travel_sec = t && t >= 0 ? t : (s.tmpTimeSec || 60);
  const insert = {
    type,
    from_chat_id: `${f.chat_id}`,
    from_page_id: from_page,
    to_chat_id: type === 'main' ? `${to_chat}` : `${f.chat_id}`,
    to_page_id: to_page,
    label, emoji, base_travel_sec,
    created_at: new Date().toISOString()
  };

  const { error } = await supa.from('gates').insert(insert);
  s.step = 0; s.tmpTimeSec = null;
  if (error) return await ctx.reply('❌ ساخت مسیر شکست خورد.', onlyHomeKb());
  await ctx.reply('✅ مسیر ساخته شد.', homeKb());
  return true;
}

// ====== انتخاب گروه مقصد با فوروارد ======
async function askDestByForward(ctx) {
  const s = stOf(ctx.from.id);
  s.step = 'dest:forward';
  await ctx.reply('یک پیام از *گروه مقصد* به همین پی‌وی *فوروارد* کن تا ثبت شود.', { parse_mode:'Markdown', ...onlyHomeKb() });
}
async function handleDestForward(ctx) {
  const s = stOf(ctx.from.id);
  if (s.step !== 'dest:forward') return false;
  const ch = ctx.message?.forward_from_chat;
  if (!ch || !(ch.type === 'group' || ch.type === 'supergroup')) {
    await ctx.reply('این فوروارد از گروه نیست.', onlyHomeKb()); return true;
  }
  s.toChatId = `${ch.id}`;
  s.toChatTitle = ch.title || ch.username || s.toChatId;
  s.step = 0;
  await ctx.reply(`✅ گروه مقصد تنظیم شد: ${s.toChatTitle}`, homeKb());
  return true;
}

// ====== ثبت اکشن‌ها ======
function register(bot){
  bot.command('link_wizard', async (ctx)=>{
    if (!await ensurePV(bot, ctx, 'جادوگر لینک 🤖 آماده‌ست. اینجا ادامه بده.')) return;
    await showHome(ctx);
  });

  bot.action('wz:home', async (ctx)=>{ if(!inPV(ctx)) return ctx.answerCbQuery().catch(()=>{}); await ctx.answerCbQuery().catch(()=>{}); await showHome(ctx); });
  bot.action('wz:new_page', async (ctx)=>{ if(!inPV(ctx)) return ctx.answerCbQuery().catch(()=>{}); await ctx.answerCbQuery().catch(()=>{}); await askPagesLines(ctx); });
  bot.action('wz:new_gate', async (ctx)=>{ if(!inPV(ctx)) return ctx.answerCbQuery().catch(()=>{}); await ctx.answerCbQuery().catch(()=>{}); await askGateLine(ctx); });
  bot.action('wz:set_dest', async (ctx)=>{ if(!inPV(ctx)) return ctx.answerCbQuery().catch(()=>{}); await ctx.answerCbQuery().catch(()=>{}); await askDestByForward(ctx); });

  // تایمرهای پرکاربرد
  bot.action(/^wz:time:(\d+)$/i, async (ctx)=>{
    if(!inPV(ctx)) return ctx.answerCbQuery().catch(()=>{});
    const s = stOf(ctx.from.id); s.tmpTimeSec = parseInt(ctx.match[1], 10) || 60;
    try { await ctx.answerCbQuery('⏱ زمان تنظیم شد'); } catch {}
  });

  // پیام‌های متنی PV (فوروارد/صفحات/مسیر)
  bot.on('message', async (ctx, next) => {
    try{
      if (!inPV(ctx)) return next();

      // 1) فوروارد برای انتخاب مقصد
      if (ctx.message?.forward_from_chat) {
        const handled = await handleDestForward(ctx);
        if (handled) return;
      }

      // 2) ساخت فله‌ای صفحه‌ها
      const s = stOf(ctx.from.id);
      if (s.step === 'pages:lines') {
        const handled = await handlePagesLines(ctx);
        if (handled) return;
      }

      // 3) ساخت مسیر از یک خط
      if (s.step === 'gate:line') {
        const handled = await handleGateLine(ctx);
        if (handled) return;
      }

      return next();
    }catch(_){ return next(); }
  });
}

module.exports = { register };
