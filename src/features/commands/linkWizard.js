const { Markup } = require('telegraf');
const NodeCache = require('node-cache');
const { parseDur } = require('../../utils/text');
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
function onlyOwner(config, ctx) {
  if (ctx.from?.id !== config.ownerId) {
    try { ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده', { reply_to_message_id: ctx.message?.message_id }); } catch {}
    return false;
  }
  return true;
}

function S(uid){ return wiz.get(`w:${uid}`)||null; }
function Sset(uid, patch){ const s={...(wiz.get(`w:${uid}`)||{}), ...patch}; wiz.set(`w:${uid}`, s); return s; }
function Sclear(uid){ wiz.del(`w:${uid}`); }

function kbCancel(){ return Markup.inlineKeyboard([[Markup.button.callback('❌ لغو ویزارد','lw:cancel')]]); }
function kbTypes(){
  return Markup.inlineKeyboard([
    [Markup.button.callback('🧭 مسیر اصلی (به گروه دیگر)','lw:type:main')],
    [Markup.button.callback('🧩 مسیر فرعی (در همین گروه)','lw:type:sub')],
    [Markup.button.callback('🪄 ریزمسیر (داخل همین صفحه)','lw:type:micro')],
    [Markup.button.callback('❌ لغو','lw:cancel')],
  ]);
}

function pageButtons(pages, purpose='from'){
  const rows = pages.slice(0, 24).map(p => [Markup.button.callback(`📜 ${p.title}`, `lw:page:${purpose}:${p.id}`)]);
  rows.push([Markup.button.callback('➕ ساخت صفحه جدید','lw:page:new')]);
  rows.push([Markup.button.callback('❌ لغو','lw:cancel')]);
  return Markup.inlineKeyboard(rows, { columns: 1 });
}

function extractChatIdFromMessage(msg){
  const fwd = msg.forward_from_chat;
  if (fwd && (fwd.type === 'group' || fwd.type === 'supergroup')) return `${fwd.id}`;
  const sc = msg.sender_chat;
  if (sc && (sc.type === 'group' || sc.type === 'supergroup')) return `${sc.id}`;
  const t = (msg.text||'').trim();
  if (/-?\d{6,20}/.test(t)) return t;
  return null;
}

async function askFromPage(ctx, from_chat_id){
  const pages = await getPages(from_chat_id);
  await ctx.reply('گام ۲) صفحهٔ مبدا را انتخاب کن یا صفحهٔ جدید بساز:', pageButtons(pages,'from'));
  Sset(ctx.from.id, { stage: 'from_page' });
}
async function askNewPageTitle(ctx, purpose){
  Sset(ctx.from.id, { stage: `new_page_title_${purpose}` });
  await ctx.reply('عنوان صفحهٔ جدید را بفرست:', kbCancel());
}
async function askNewPageDesc(ctx, purpose){
  Sset(ctx.from.id, { stage: `new_page_desc_${purpose}` });
  await ctx.reply('توضیحات/اینفو اختیاری صفحه را بفرست (یا «-» برای خالی):', kbCancel());
}
async function askType(ctx){
  Sset(ctx.from.id, { stage: 'type' });
  await ctx.reply('گام ۳) نوع مسیر را انتخاب کن:', kbTypes());
}
async function askToChat(ctx, type, from_chat_id){
  if (type === 'sub' || type === 'micro') {
    return askToPage(ctx, from_chat_id, type);
  }
  Sset(ctx.from.id, { stage: 'to_chat' });
  await ctx.reply(
    'گام ۴) گروه مقصد:\n' +
    '• یک پیام از گروه مقصد را فوروارد کن\n' +
    'یا آیدی عددی مقصد را بفرست.',
    kbCancel()
  );
}
async function askToPage(ctx, chat_id, type){
  const pages = await getPages(chat_id);
  const head = (type==='sub' || type==='micro')
    ? 'گام ۴) صفحهٔ مقصد (در همین گروه):'
    : 'گام ۵) صفحهٔ مقصد:';
  await ctx.reply(head, pageButtons(pages,'to'));
  Sset(ctx.from.id, { stage: 'to_page' });
}
async function askLabel(ctx){
  Sset(ctx.from.id, { stage: 'label' });
  await ctx.reply('برچسب مسیر را بفرست (مثلاً «ورود به بازار»):', kbCancel());
}
async function askEmoji(ctx){
  Sset(ctx.from.id, { stage: 'emoji' });
  await ctx.reply('اختیاری) ایموجی بفرست. برای رد کردن «-» ارسال کن.', kbCancel());
}
async function askEta(ctx){
  Sset(ctx.from.id, { stage: 'eta' });
  await ctx.reply('مدت مسیر را بفرست (مثل 5m یا 120s) — حداقل 10s:', kbCancel());
}
async function askRouteNote(ctx){
  Sset(ctx.from.id, { stage: 'note' });
  await ctx.reply('توضیحات/اینفو اختیاری برای مسیر بفرست (یا «-» برای خالی):', kbCancel());
}

async function summary(ctx, st){
  const toChat = st.type==='main' ? st.to_chat_id : st.from_chat_id;
  const lines = [
    '✅ مرور نهایی:',
    `• نوع: ${st.type==='main'?'مسیر اصلی':st.type==='sub'?'مسیر فرعی':'ریزمسیر'}`,
    `• مبدا: ${st.from_chat_id} | صفحه: ${st.from_page_id}`,
    `• مقصد: ${toChat} | صفحه: ${st.to_page_id || st.from_page_id}`,
    `• برچسب: ${st.label}`,
    `• ایموجی: ${st.emoji||'-'}`,
    `• زمان: ${st.base_travel_sec} ثانیه`,
    `• توضیحات: ${st.note||'-'}`
  ];
  return ctx.reply(lines.join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ ذخیره','lw:save')],
      [Markup.button.callback('❌ لغو','lw:cancel')]
    ])
  );
}

async function askMakeReverse(ctx, gateId, st){
  const text = 'مسیر ذخیره شد. مسیر برگشت هم بسازم؟';
  const rev = {
    type: st.type,
    from_chat_id: st.type==='main' ? st.to_chat_id : st.from_chat_id,
    to_chat_id: st.type==='main' ? st.from_chat_id : st.from_chat_id,
    from_page_id: st.to_page_id || st.from_page_id,
    to_page_id: st.from_page_id,
    // برچسب و زمان را جدا می‌گیریم
  };
  const payload = Buffer.from(JSON.stringify(rev)).toString('base64');
  await ctx.reply(text, Markup.inlineKeyboard([
    [Markup.button.callback('✅ بله','lw:rev_yes:'+payload)],
    [Markup.button.callback('🚫 نه','lw:rev_no')]
  ]));
}

function register(bot, config){

  // گروه → پاک کردن پیام و شروع PV (بدون پیام راهنما مگر PV بسته باشد)
  bot.command('link_wizard', async (ctx)=>{
    if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') {
      if (!onlyOwner(config, ctx)) return;
      try { await ctx.deleteMessage(); } catch {}
      const uid = ctx.from.id;
      const fromChatId = `${ctx.chat.id}`;
      Sclear(uid);
      Sset(uid, { stage: 'from_page', from_chat_id: fromChatId });
      const title = ctx.chat.title || fromChatId;
      try {
        await ctx.telegram.sendMessage(uid, `✨ ویزارد ساخت مسیر برای «${title}» شروع شد.\n\nگام ۲) صفحهٔ مبدا را انتخاب کن یا صفحهٔ جدید بساز:`);
        await askFromPage({ ...ctx, from: { id: uid } }, fromChatId);
      } catch {
        const me = ctx.botInfo?.username; if(!me) return;
        const url = `https://t.me/${me}`;
        const m = await ctx.reply('برای شروع ویزارد، لطفاً یک‌بار به پی‌وی من برو و /start بزن.', Markup.inlineKeyboard([[Markup.button.url('📥 باز کردن پی‌وی ربات', url)]]));
        setTimeout(() => { ctx.deleteMessage(m.message_id).catch(()=>{}); }, 8000);
      }
      return;
    }

    // PV
    if (!onlyOwnerPV(config, ctx)) return;
    Sclear(ctx.from.id);
    Sset(ctx.from.id, { stage: 'from_chat' });
    await ctx.reply('✨ ویزارد ساخت مسیر شروع شد.');
    await ctx.reply(
      'گام ۱) گروه مبدا را مشخص کن:\n' +
      '• یک پیام از آن گروه را به اینجا *فوروارد* کن\n' +
      'یا\n' +
      '• آیدی عددی گروه را بفرست (مثل -1001234567890)',
      { parse_mode:'Markdown', ...kbCancel() }
    );
  });

  // لغو
  bot.action(/^lw:cancel$/i, async (ctx)=>{
    Sclear(ctx.from.id);
    try{ await ctx.answerCbQuery('لغو شد'); }catch{}
    try{ await ctx.editMessageReplyMarkup({inline_keyboard:[]}); }catch{}
  });

  // انتخاب نوع
  bot.action(/^lw:type:(main|sub|micro)$/i, async (ctx)=>{
    const s = S(ctx.from.id); if(!s || s.stage!=='type') return ctx.answerCbQuery().catch(()=>{});
    const type = ctx.match[1];
    Sset(ctx.from.id, { type });
    try{ await ctx.answerCbQuery('انتخاب شد'); }catch{}
    await askToChat(ctx, type, s.from_chat_id);
  });

  // انتخاب صفحه (from/to) یا ساخت صفحه جدید
  bot.action(/^lw:page:(from|to):(new|\d+)$/i, async (ctx)=>{
    const s = S(ctx.from.id); if(!s) return ctx.answerCbQuery().catch(()=>{});
    const purpose = ctx.match[1];
    const val = ctx.match[2];
    if(val === 'new'){
      await ctx.answerCbQuery().catch(()=>{});
      return askNewPageTitle(ctx, purpose);
    }
    const pid = parseInt(val,10);
    if(purpose==='from'){
      Sset(ctx.from.id, { from_page_id: pid });
      try{ await ctx.answerCbQuery('صفحه مبدا انتخاب شد'); }catch{}
      return askType(ctx);
    }else{
      Sset(ctx.from.id, { to_page_id: pid });
      try{ await ctx.answerCbQuery('صفحه مقصد انتخاب شد'); }catch{}
      return askLabel(ctx);
    }
  });

  // ذخیره مسیر
  bot.action(/^lw:save$/i, async (ctx)=>{
    const s = S(ctx.from.id); if(!s || s.stage!=='confirm') return ctx.answerCbQuery().catch(()=>{});
    try{
      const gate = {
        type: s.type, // main | sub | micro
        from_chat_id: s.from_chat_id,
        from_page_id: s.from_page_id,
        to_chat_id: s.type==='main' ? s.to_chat_id : s.from_chat_id,
        to_page_id: s.type==='micro' ? s.from_page_id : (s.to_page_id || s.from_page_id),
        label: s.label,
        emoji: s.emoji || null,
        base_travel_sec: s.base_travel_sec,
        note: s.note || null,
        active: true,
        order_index: s.order_index || 0,
        section: s.section || null
      };
      const res = await insertGate(gate);
      const err = res?.error || (typeof res==='string' ? res : null);
      if (err) {
        await ctx.reply('❌ خطا در ذخیره مسیر: ' + (err.message || err));
      } else {
        await ctx.reply('✅ مسیر ذخیره شد');
        // پیشنهاد ساخت مسیر برگشت (برای main و sub)
        if(s.type==='main' || s.type==='sub'){
          await askMakeReverse(ctx, res?.id || null, s);
        }
      }
    } catch {
      await ctx.reply('❌ خطا در ذخیره');
    }
    try{ await ctx.answerCbQuery('ذخیره شد'); }catch{}
    // سشن را فعلاً نگه می‌داریم برای برگشت
    Sset(ctx.from.id, { ...S(ctx.from.id), stage:'saved' });
  });

  // ساخت برگشت
  bot.action(/^lw:rev_no$/i, async (ctx)=>{
    try{ await ctx.answerCbQuery('اوکی'); }catch{}
    Sclear(ctx.from.id);
  });

  bot.action(/^lw:rev_yes:([A-Za-z0-9+/=]+)$/i, async (ctx)=>{
    const s = S(ctx.from.id); if(!s) return ctx.answerCbQuery().catch(()=>{});
    let rev; try{ rev=JSON.parse(Buffer.from(ctx.match[1],'base64').toString('utf8')); }catch{ rev=null; }
    if(!rev) { try{ await ctx.answerCbQuery(); }catch{} return; }
    // حالا لیبل/مدت برگشت را بگیریم
    Sset(ctx.from.id, { stage:'rev_label', _rev:rev });
    try{ await ctx.answerCbQuery(); }catch{}
    await ctx.reply('برچسب مسیر برگشت را بفرست (یا «-» برای استفاده از همان برچسب با «برگشت»):', kbCancel());
  });

  // پیام‌های آزاد (PV) — مراحل ویزارد
  bot.on('message', async (ctx, next)=>{
    if(ctx.chat?.type!=='private') return next();
    const s = S(ctx.from.id);
    if(!s) return next();

    // گام ۱: تعیین گروه مبدا (فوروارد/آیدی)
    if(s.stage==='from_chat'){
      const cid = extractChatIdFromMessage(ctx.message);
      if(!cid) return ctx.reply('آیدی/فوروارد نامعتبر. دوباره بفرست.', kbCancel());
      Sset(ctx.from.id, { from_chat_id: cid });
      await ctx.reply(`✅ گروه مبدا: ${cid}`);
      return askFromPage(ctx, cid);
    }

    // ساخت صفحه جدید: عنوان + توضیحات
    if(s.stage==='new_page_title_from' || s.stage==='new_page_title_to'){
      const title = (ctx.message.text||'').trim();
      if(!title) return ctx.reply('عنوان نامعتبر.', kbCancel());
      Sset(ctx.from.id, { tmp_new_page_title: title });
      return askNewPageDesc(ctx, s.stage.endsWith('_from') ? 'from' : 'to');
    }
    if(s.stage==='new_page_desc_from' || s.stage==='new_page_desc_to'){
      const descTxt = (ctx.message.text||'').trim();
      const desc = (descTxt==='-'?'':descTxt);
      const title = S(ctx.from.id)?.tmp_new_page_title;
      const purpose = s.stage.endsWith('_from') ? 'from' : 'to';
      const chatId = purpose==='from' ? s.from_chat_id : (s.to_chat_id || s.from_chat_id);
      const { id, error } = await insertPage(chatId, title, desc);
      if(error) return ctx.reply('❌ خطا در ساخت صفحه: ' + (error.message||''));      
      if(purpose==='from'){
        Sset(ctx.from.id, { from_page_id: id, tmp_new_page_title: null });
        await ctx.reply(`✅ صفحه مبدا ساخته شد: ${title}`);
        return askType(ctx);
      } else {
        Sset(ctx.from.id, { to_page_id: id, tmp_new_page_title: null });
        await ctx.reply(`✅ صفحه مقصد ساخته شد: ${title}`);
        return askLabel(ctx);
      }
    }

    // گام to_chat (فقط main)
    if(s.stage==='to_chat'){
      const cid = extractChatIdFromMessage(ctx.message);
      if(!cid) return ctx.reply('آیدی/فوروارد مقصد نامعتبر. دوباره بفرست.', kbCancel());
      Sset(ctx.from.id, { to_chat_id: cid });
      await ctx.reply(`✅ گروه مقصد: ${cid}`);
      return askToPage(ctx, cid, 'main');
    }

    // برچسب مسیر
    if(s.stage==='label'){
      const label = (ctx.message.text||'').trim();
      if(!label) return ctx.reply('برچسب نامعتبر.', kbCancel());
      Sset(ctx.from.id, { label });
      return askEmoji(ctx);
    }

    // ایموجی
    if(s.stage==='emoji'){
      const emojiTxt = (ctx.message.text||'').trim();
      const emoji = (emojiTxt==='-'||emojiTxt==='') ? null : emojiTxt.slice(0,2);
      Sset(ctx.from.id, { emoji });
      return askEta(ctx);
    }

    // مدت مسیر
    if(s.stage==='eta'){
      const durTxt = (ctx.message.text||'').trim();
      const sec = parseDur(durTxt);
      if(!sec || sec<10) return ctx.reply('زمان نامعتبر. مثال: 5m یا 120s. حداقل 10s', kbCancel());
      Sset(ctx.from.id, { base_travel_sec: sec });
      return askRouteNote(ctx);
    }

    // توضیحات مسیر
    if(s.stage==='note'){
      const noteTxt = (ctx.message.text||'').trim();
      const note = (noteTxt==='-'?'':noteTxt);
      Sset(ctx.from.id, { note, stage:'confirm' });
      return summary(ctx, S(ctx.from.id));
    }

    // برچسب برگشت
    if(s.stage==='rev_label'){
      const txt = (ctx.message.text||'').trim();
      const base = S(ctx.from.id);
      const rev = base._rev || {};
      let label = txt;
      if(txt==='-'||txt===''){ label = (base.label||'مسیر') + ' (برگشت)'; }
      Sset(ctx.from.id, { _rev: { ...rev, label }, stage:'rev_eta' });
      return ctx.reply('مدت مسیر برگشت را بفرست (یا «-» برای همان مدت):', kbCancel());
    }

    // مدت برگشت
    if(s.stage==='rev_eta'){
      const txt = (ctx.message.text||'').trim();
      const base = S(ctx.from.id);
      const rev = base._rev || {};
      let sec = base.base_travel_sec;
      if(txt!=='-'){
        const p = parseDur(txt);
        if(!p || p<10) return ctx.reply('زمان نامعتبر. مثال: 5m یا 120s. حداقل 10s', kbCancel());
        sec = p;
      }
      try{
        const gate = {
          type: base.type,
          from_chat_id: rev.from_chat_id,
          to_chat_id: rev.to_chat_id,
          from_page_id: rev.from_page_id,
          to_page_id: rev.to_page_id,
          label: rev.label,
          emoji: base.emoji || null,
          base_travel_sec: sec,
          note: base.note || null,
          active: true
        };
        const res = await insertGate(gate);
        const err = res?.error || (typeof res==='string' ? res : null);
        if(err) await ctx.reply('❌ خطا در ساخت مسیر برگشت: ' + (err.message||err));
        else await ctx.reply('✅ مسیر برگشت ساخته شد');
      }catch{
        await ctx.reply('❌ خطا در ساخت مسیر برگشت');
      }
      Sclear(ctx.from.id);
      return;
    }

    return next();
  });
}

module.exports = { register };
