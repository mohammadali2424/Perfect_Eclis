// src/features/commands/linkWizard.js
const { Markup } = require('telegraf');
const NodeCache = require('node-cache');
const { parseDur } = require('../../utils/text');
const { supa } = require('../../infra/supabase');
const { getPages, insertPage } = require('../../domain/repositories/pagesRepo');
const { insertGate } = require('../../domain/repositories/gatesRepo');

const wiz = new NodeCache({ stdTTL: 1800, checkperiod: 120, maxKeys: 5000 }); // 30m

function onlyOwnerPV(config, ctx) {
  if (ctx.chat?.type !== 'private') {
    try { ctx.reply('این فرمان فقط در پی‌وی ربات قابل استفاده است.'); } catch {}
    return false;
  }
  if (ctx.from?.id !== config.ownerId) {
    try { ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده'); } catch {}
    return false;
  }
  return true;
}

function kbCancel() {
  return Markup.inlineKeyboard([[Markup.button.callback('❌ لغو', 'lw:cancel')]], { columns: 1 });
}
function kbBack() {
  return Markup.inlineKeyboard([[Markup.button.callback('◀️ بازگشت', 'lw:back')]], { columns: 1 });
}

async function hintSendChat(ctx){
  return ctx.reply(
    'گام ۱) مشخص کن «از کدام گروه» می‌خواهی مسیر بسازی:\n'+
    '• یک پیام از آن گروه را به اینجا *فوروارد* کن\n'+
    'یا\n'+
    '• آیدی عددی گروه را ارسال کن (مثل -1001234567890)',
    { parse_mode:'Markdown', ...kbCancel() }
  );
}

function explain(ctx){
  return ctx.reply(
    'دستیار ساخت لینک:\n'+
    '• /lw_page <عنوان>  — ساخت صفحه در گروه انتخاب‌شده\n'+
    '• /lw_gate type=<main|sub> from_page=<id> to_chat=<id> to_page=<id> label=... emoji=... time=5m',
    kbBack()
  );
}

function parseArgs(txt){
  const args = {};
  for (const part of txt.split(/\s+/).slice(1)) {
    const m = part.match(/^([a-z_]+)=(.+)$/i);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function register(bot, config) {
  bot.command('link_wizard', async (ctx)=>{
    if (!onlyOwnerPV(config, ctx)) return;
    wiz.set(`phase:${ctx.from.id}`, { step: 'start' });
    await hintSendChat(ctx);
  });

  bot.on('message', async (ctx, next)=>{
    const phase = wiz.get(`phase:${ctx.from?.id}`);
    if (!phase) return next();
    if (ctx.chat?.type !== 'private') return next();

    const txt = ctx.message?.text || '';
    if (/^-?\d{7,20}$/.test(txt) || ctx.message?.forward_from_chat?.id) {
      const chatId = ctx.message?.forward_from_chat?.id || parseInt(txt,10);
      wiz.set(`wiz:${ctx.from.id}`, { chat_id: `${chatId}` });
      await ctx.reply(`گروه انتخاب شد: ${chatId}`);
      return explain(ctx);
    }
    return next();
  });

  bot.command('lw_page', async (ctx)=>{
    if (!onlyOwnerPV(config, ctx)) return;
    const wizS = wiz.get(`wiz:${ctx.from.id}`);
    if (!wizS?.chat_id) return ctx.reply('ابتدا /link_wizard');
    const title = (ctx.message?.text || '').split(/\s+/).slice(1).join(' ').trim();
    if (!title) return ctx.reply('فرمت: /lw_page <عنوان>');
    const { id, error } = await insertPage(wizS.chat_id, title, '');
    if (error) return ctx.reply('خطا در ساخت صفحه');
    ctx.reply(`✅ صفحه ساخته شد: ${id}`);
  });

  bot.command('lw_gate', async (ctx)=>{
    if (!onlyOwnerPV(config, ctx)) return;
    const wizS = wiz.get(`wiz:${ctx.from.id}`);
    if (!wizS?.chat_id) return ctx.reply('ابتدا /link_wizard');

    const args = parseArgs(ctx.message?.text || '');
    const type = (args.type || 'main').toLowerCase();
    const from_page = args.from_page;
    const to_chat = args.to_chat;
    const to_page = args.to_page;
    const label = args.label || '';
    const emoji = args.emoji || '';
    const timeSec = parseDur(args.time || '1m') || 60;

    if (!from_page || !to_chat || !to_page) return ctx.reply('پارامترها ناقص‌اند');

    const ins = {
      type,
      from_chat_id: wizS.chat_id,
      from_page_id: from_page,
      to_chat_id: to_chat,
      to_page_id: to_page,
      label, emoji,
      base_travel_sec: timeSec,
      order_index: Math.floor(Date.now()/1000),
      active: true
    };
    const err = await insertGate(ins);
    if (err) return ctx.reply('خطا در ساخت مسیر');
    ctx.reply('✅ مسیر ساخته شد');
  });

  bot.action('lw:cancel', (ctx)=>{ wiz.del(`phase:${ctx.from?.id}`); ctx.answerCbQuery('لغو شد').catch(()=>{}); });
  bot.action('lw:back', async (ctx)=>{ await hintSendChat(ctx); });
}
module.exports = { register };