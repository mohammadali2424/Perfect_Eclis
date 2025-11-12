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

function state(uid) {
  return wiz.get(`w:${uid}`) || null;
}
function setState(uid, patch) {
  const s = { ...(wiz.get(`w:${uid}`) || {}), ...patch };
  wiz.set(`w:${uid}`, s);
  return s;
}
function clearState(uid) { wiz.del(`w:${uid}`); }

function kbCancel() {
  return Markup.inlineKeyboard([[Markup.button.callback('❌ لغو ویزارد','lw:cancel')]]);
}
function kbTypes() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🧭 مسیر اصلی (به گروه دیگر)','lw:type:main')],
    [Markup.button.callback('🧩 مسیر فرعی (در همین گروه)','lw:type:sub')],
    [Markup.button.callback('❌ لغو','lw:cancel')]
  ]);
}
function pageButtons(pages) {
  const rows = pages.slice(0, 24).map(p => [Markup.button.callback(`📜 ${p.title}`, `lw:page:${p.id}`)]);
  rows.push([Markup.button.callback('➕ ساخت صفحه جدید','lw:page:new')]);
  rows.push([Markup.button.callback('❌ لغو','lw:cancel')]);
  return Markup.inlineKeyboard(rows, { columns: 1 });
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

function extractChatIdFromMessage(msg){
  const fwd = msg.forward_from_chat;
  if (fwd && (fwd.type === 'group' || fwd.type === 'supergroup')) {
    return `${fwd.id}`;
  }
  const sc = msg.sender_chat;
  if (sc && (sc.type === 'group' || sc.type === 'supergroup')) {
    return `${sc.id}`;
  }
  if (msg.text && /-?\d{6,20}/.test(msg.text.trim())) {
    return msg.text.trim();
  }
  return null;
}

async function askFromPage(ctx, from_chat_id){
  const pages = await getPages(from_chat_id);
  await ctx.reply(`گام ۲) کدام «صفحه مبدا»؟`, pageButtons(pages));
  setState(ctx.from.id, { stage: 'from_page' });
}

async function askType(ctx){
  await ctx.reply('گام ۳) نوع مسیر را انتخاب کن:', kbTypes());
  setState(ctx.from.id, { stage: 'type' });
}

async function askToChat(ctx, type, from_chat_id){
  if (type === 'sub') {
    return askToPage(ctx, from_chat_id, true);
  }
  await ctx.reply(
    'گام ۴) گروه مقصد:\n'+
    '• یک پیام از گروه مقصد را فوروارد کن\n'+
    'یا آیدی عددی مقصد را بفرست.',
    kbCancel()
  );
  setState(ctx.from.id, { stage: 'to_chat' });
}

async function askToPage(ctx, chat_id, isSub){
  const pages = await getPages(chat_id);
  const head = isSub ? 'گام ۴) صفحهٔ مقصد (در همین گروه):' : 'گام ۵) صفحهٔ مقصد:';
  await ctx.reply(head, pageButtons(pages));
  setState(ctx.from.id, { stage: 'to_page' });
}

async function askLabel(ctx){
  await ctx.reply('گام بعدی) متن برچسب مسیر را بفرست (مثلاً «ورود به بازار»):', kbCancel());
  setState(ctx.from.id, { stage: 'label' });
}
async function askEmoji(ctx){
  await ctx.reply('اختیاری) یک ایموجی (یا خالی) بفرست. برای رد کردن، «-» بفرست.', kbCancel());
  setState(ctx.from.id, { stage: 'emoji' });
}
async function askEta(ctx){
  await ctx.reply('زمان مسیر را بفرست (مثلاً 5m یا 120s). حداقل 10s:', kbCancel());
  setState(ctx.from.id, { stage: 'eta' });
}

async function summary(ctx, st){
  const lines = [
    '✅ مرور نهایی:',
    `• نوع: ${st.type==='main'?'مسیر اصلی':'مسیر فرعی'}`,
    `• مبدا: ${st.from_chat_id} | صفحه: ${st.from_page_id}`,
    `• مقصد: ${st.to_chat_id} | صفحه: ${st.to_page_id}`,
    `• برچسب: ${st.label}`,
    `• ایموجی: ${st.emoji||'-'}`,
    `• زمان: ${st.base_travel_sec} ثانیه`
  ];
  return ctx.reply(lines.join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ ذخیره','lw:save')],
      [Markup.button.callback('❌ لغو','lw:cancel')]
    ])
  );
}

function register(bot, config){

  bot.command('link_wizard', async (ctx)=>{
    if(!onlyOwnerPV(config,ctx)) return;
    clearState(ctx.from.id);
    setState(ctx.from.id, { stage: 'from_chat' });
    await ctx.reply('✨ ویزارد ساخت مسیر شروع شد.');
    await hintSendChat(ctx);
  });

  bot.action(/^lw:cancel$/i, async (ctx)=>{
    clearState(ctx.from.id);
    try{ await ctx.answerCbQuery('لغو شد'); }catch{}
    try{ await ctx.editMessageReplyMarkup({inline_keyboard:[]}); }catch{}
  });

  bot.action(/^lw:type:(main|sub)$/i, async (ctx)=>{
    const s = state(ctx.from.id); if(!s || s.stage!=='type') return ctx.answerCbQuery().catch(()=>{});
    const type = ctx.match[1];
    setState(ctx.from.id, { type });
    try{ await ctx.answerCbQuery(type==='main'?'مسیر اصلی':'مسیر فرعی'); }catch{}
    await askToChat(ctx, type, s.from_chat_id);
  });

  bot.action(/^lw:page:(new|\d+)$/i, async (ctx)=>{
    const s = state(ctx.from.id); if(!s) return ctx.answerCbQuery().catch(()=>{});
    const val = ctx.match[1];
    if(val === 'new'){
      setState(ctx.from.id, { stage: 'new_page_title' });
      try{ await ctx.answerCbQuery('ساخت صفحه جدید'); }catch{}
      return ctx.reply('عنوان صفحه جدید را بفرست:', kbCancel());
    }
    const pid = parseInt(val,10);
    if(s.stage === 'from_page'){
      setState(ctx.from.id, { from_page_id: pid });
      try{ await ctx.answerCbQuery('صفحه مبدا انتخاب شد'); }catch{}
      return askType(ctx);
    }
    if(s.stage === 'to_page'){
      setState(ctx.from.id, { to_page_id: pid });
      try{ await ctx.answerCbQuery('صفحه مقصد انتخاب شد'); }catch{}
      return askLabel(ctx);
    }
    return ctx.answerCbQuery().catch(()=>{});
  });

  bot.action(/^lw:save$/i, async (ctx)=>{
    const s = state(ctx.from.id); if(!s || s.stage!=='confirm') return ctx.answerCbQuery().catch(()=>{});
    try{
      const gate = {
        type: s.type,
        from_chat_id: s.from_chat_id,
        from_page_id: s.from_page_id,
        to_chat_id: s.to_chat_id,
        to_page_id: s.to_page_id,
        label: s.label,
        emoji: s.emoji || null,
        base_travel_sec: s.base_travel_sec,
        active: true,
        order_index: s.order_index || 0,
        section: s.section || null
      };
      const error = await insertGate(gate);
      if (error) {
        await ctx.reply('❌ خطا در ذخیره مسیر: ' + (error.message || ''));
      } else {
        await ctx.reply('✅ مسیر ذخیره شد');
      }
    } catch (e){
      await ctx.reply('❌ خطا در ذخیره');
    }
    clearState(ctx.from.id);
    try{ await ctx.answerCbQuery('ذخیره شد'); }catch{}
  });

  bot.on('message', async (ctx, next)=>{
    if(ctx.chat?.type!=='private') return next();
    const s = state(ctx.from.id);
    if(!s) return next();

    if(s.stage==='from_chat'){
      const cid = extractChatIdFromMessage(ctx.message);
      if(!cid) return ctx.reply('آیدی/فوروارد نامعتبر. دوباره بفرست.', kbCancel());
      setState(ctx.from.id, { from_chat_id: cid });
      await ctx.reply(`✅ گروه مبدا: ${cid}`);
      return askFromPage(ctx, cid);
    }

    if(s.stage==='new_page_title'){
      const title = (ctx.message.text||'').trim();
      if(!title) return ctx.reply('عنوان نامعتبر.');
      if(s.from_page_id==null && s.stage_from_page !== false){
        const { id, error } = await insertPage(s.from_chat_id, title, '');
        if(error) return ctx.reply('❌ خطا در ساخت صفحه: ' + (error.message||''));
        setState(ctx.from.id, { from_page_id: id, stage_from_page:false });
        await ctx.reply(`✅ صفحه مبدا ساخته شد: ${title}`);
        return askType(ctx);
      } else if (s.to_chat_id){
        const { id, error } = await insertPage(s.to_chat_id, title, '');
        if(error) return ctx.reply('❌ خطا در ساخت صفحه: ' + (error.message||''));
        setState(ctx.from.id, { to_page_id: id });
        await ctx.reply(`✅ صفحه مقصد ساخته شد: ${title}`);
        return askLabel(ctx);
      } else {
        return ctx.reply('❌ حالت نامشخص؛ از اول /link_wizard بزن');
      }
    }

    if(s.stage==='to_chat'){
      if(s.type==='sub'){
        setState(ctx.from.id, { stage:'to_page' });
        return askToPage(ctx, s.from_chat_id, true);
      }
      const cid = extractChatIdFromMessage(ctx.message);
      if(!cid) return ctx.reply('آیدی/فوروارد مقصد نامعتبر. دوباره بفرست.', kbCancel());
      setState(ctx.from.id, { to_chat_id: cid });
      await ctx.reply(`✅ گروه مقصد: ${cid}`);
      return askToPage(ctx, cid, false);
    }

    if(s.stage==='label'){
      const label = (ctx.message.text||'').trim();
      if(!label) return ctx.reply('برچسب نامعتبر.');
      setState(ctx.from.id, { label });
      return askEmoji(ctx);
    }

    if(s.stage==='emoji'){
      const emojiTxt = (ctx.message.text||'').trim();
      const emoji = (emojiTxt==='-'||emojiTxt==='') ? null : emojiTxt.slice(0,2);
      setState(ctx.from.id, { emoji });
      return askEta(ctx);
    }

    if(s.stage==='eta'){
      const durTxt = (ctx.message.text||'').trim();
      const sec = parseDur(durTxt);
      if(!sec || sec<10) return ctx.reply('زمان نامعتبر. مثال: 5m یا 120s. حداقل 10s');
      if(s.type==='sub'){
        setState(ctx.from.id, { to_chat_id: s.from_chat_id });
      }
      setState(ctx.from.id, { base_travel_sec: sec, stage:'confirm' });
      return summary(ctx, state(ctx.from.id));
    }

    return next();
  });
}

module.exports = { register };
