const { Markup } = require('telegraf');
const NodeCache = require('node-cache');
const { parseDur } = require('../../utils/text');
const { supa } = require('../../infra/supabase');
const { getPages, insertPage } = require('../../domain/repositories/pagesRepo');
const { insertGate } = require('../../domain/repositories/gatesRepo');

const wiz = new NodeCache({ stdTTL: 1800, checkperiod: 120, maxKeys: 5000 }); // 30m

function onlyOwnerPV(config, ctx) {
  // اگر در گروه یا سوپرگروه استفاده شود، پیام را پاک کن و کاربر را به پی‌وی بفرست
  if (ctx.chat?.type !== 'private') {
    const chatId = ctx.chat.id;
    const msgId = ctx.message?.message_id;
    const userId = ctx.from?.id;
    const botUsername = ctx.botInfo?.username || ctx.me?.username;

    // ۱) پاک کردن خود پیام /link_wizard در گروه
    if (msgId) {
      try { ctx.deleteMessage(msgId); } catch (e) {}
    }

    // اگر userId موجود بود، تلاش کنیم در پی‌وی پیام بدهیم
    if (userId && botUsername) {
      const url = `https://t.me/${botUsername}?start=linkwizard`;

      ctx.telegram.sendMessage(
        userId,
        '🔧 ویزارد لینک فقط در پی‌وی ربات قابل استفاده است. از همینجا /link_wizard را بفرست.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📥 باز کردن پی‌وی ربات', url }]
            ]
          }
        }
      ).catch(async () => {
        // اگر نتوانست در پی‌وی پیام بدهد (یعنی کاربر هنوز /start نزده)
        try {
          const m = await ctx.reply(
            'برای استفاده از ویزارد لینک، اول باید پی‌وی ربات را باز کنی و /start بزنی.',
            Markup.inlineKeyboard([
              [Markup.button.url('📥 باز کردن پی‌وی ربات', `https://t.me/${botUsername}`)]
            ])
          );
          // پیام راهنما در گروه بعد از چند ثانیه پاک شود تا گروه شلوغ نشود
          setTimeout(() => {
            try { ctx.telegram.deleteMessage(chatId, m.message_id); } catch (e) {}
          }, 8000);
        } catch (e) {}
      });
    }

    return false;
  }

  // اینجا یعنی در پی‌وی هستیم → فقط مالک اجازه دارد
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

async function hintSendChat(ctx){
  return ctx.reply(
    'گام ۱) مشخص کن «از کدام گروه» می‌خواهی مسیر بسازی:\n'+
    '• یک پیام از آن گروه را به اینجا *فوروارد* کن\n'+
    'یا\n'+
    '• آیدی عددی گروه را ارسال کن (مثل -1001234567890)',
    { parse_mode:'Markdown', ...kbCancel() }
  );
}

function explainTypes(ctx){
  return ctx.reply(
    'گام ۲) نوع مسیر را انتخاب کن:\n\n'+
    '• main = مسیر اصلی → کاربر را به *گروه دیگر* می‌برد\n'+
    '• sub = مسیر فرعی → کاربر را در همین گروه، به *صفحه‌ی دیگر* می‌برد\n'+
    '• micro = مسیر ریز → حالت سبک/داخلی در همان صفحه (بدون جابه‌جایی)\n\n'+
    'مثال:\n'+
    '`/lw_gate type=main from_page=1 to_chat=-100222 to_page=1 label=دروازه‌ی شهر emoji=🚪 time=5m`\n\n'+
    'پیشنهاد: اول با sub شروع کن، منطق صفحه‌ها را بچین، بعد mainها را بساز.',
    { parse_mode:'Markdown', ...kbCancel() }
  );
}

async function listPages(ctx,chatId){
  const pages=await getPages(chatId);
  if(!pages.length) return ctx.reply('هیچ صفحه‌ای برای این گروه ثبت نشده. از /lw_page استفاده کن.');
  const lines=['صفحه‌های این گروه:'];
  for(const p of pages){
    lines.push(`• #${p.id} ┊ ${p.title}`);
  }
  return ctx.reply(lines.join('\n'));
}

async function handlePageCommand(ctx,config,params){
  if(!onlyOwnerPV(config,ctx)) return;

  const title = params.join(' ').trim();
  if(!title) return ctx.reply('عنوان صفحه را بعد از /lw_page بنویس.\nمثال:\n`/lw_page میدان شهر`',{parse_mode:'Markdown'});

  const fromChatId = ctx.chat.id; // در پی‌وی، اما صفحه مربوط به آخرین گروه انتخابی از ویزارد است
  const st = state(ctx.from.id);

  if(!st || !st.from_chat_id){
    // اگر هنوز گروه مبدا مشخص نشده، اول ویزارد انتخاب گروه را برویم
    await hintSendChat(ctx);
    return;
  }

  const chatId = st.from_chat_id;

  const { id, error } = await insertPage(chatId, title, null);
  if(error || !id){
    return ctx.reply('❌ خطا در ساخت صفحه. بعداً در پنل دیتابیس چک کن.');
  }

  await listPages(ctx,chatId);
  return ctx.reply(`✅ صفحه‌ی جدید با شناسه‌ی #${id} ساخته شد.`);
}

function parseGateParams(args){
  const obj={};
  for(const part of args){
    const [k,...rest]=part.split('=');
    if(!k||!rest.length) continue;
    obj[k.trim()]=rest.join('=').trim();
  }
  return obj;
}

async function ensureChatIdFromStateOrMessage(ctx){
  const uId = ctx.from.id;
  const st = state(uId);

  if(st?.from_chat_id) return st.from_chat_id;

  // اگر هنوز from_chat_id نداریم، از کاربر می‌خواهیم گروه را مشخص کند
  await hintSendChat(ctx);
  return null;
}

async function handleGateCommand(ctx,config,args){
  if(!onlyOwnerPV(config,ctx)) return;

  const params = parseGateParams(args);
  const type = (params.type||'').toLowerCase();
  if(!['main','sub','micro'].includes(type)){
    return ctx.reply(
      'type نامعتبر.\nباید یکی از این‌ها باشد: main / sub / micro\nمثال:\n`/lw_gate type=main from_page=1 to_chat=-100222 to_page=1 label=دروازه emoji=🚪 time=5m`',
      { parse_mode:'Markdown' }
    );
  }

  let from_chat_id = params.from_chat || params.from_chat_id;
  let to_chat_id = params.to_chat || params.to_chat_id;
  const label = params.label || 'مسیر بدون نام';
  const emoji = params.emoji || '';
  const timeTxt = params.time || params.t || '5m';

  const base_travel_sec = parseDur(timeTxt);
  if(!base_travel_sec || base_travel_sec < 10){
    return ctx.reply('زمان نامعتبر است. مثال: 5m یا 120s. حداقل 10 ثانیه.');
  }

  const userId = ctx.from.id;
  let st = state(userId) || {};

  // اگر from_chat_id مشخص نشده، از state یا ویزارد قبلی بگیر
  if(!from_chat_id){
    if(st.from_chat_id) from_chat_id = st.from_chat_id;
    else{
      await hintSendChat(ctx);
      return;
    }
  }

  // اگر to_chat_id در type=sub یا micro خالی است، یعنی در همان گروه
  if(type==='sub' || type==='micro'){
    to_chat_id = from_chat_id;
  }

  // صفحه‌های from/to
  const from_page_id = parseInt(params.from_page || params.from_page_id || '0',10) || null;
  const to_page_id = parseInt(params.to_page || params.to_page_id || '0',10) || null;

  if(!from_page_id){
    return ctx.reply('from_page را مشخص کن. مثال: from_page=1');
  }

  if((type==='main' || type==='sub') && !to_page_id){
    return ctx.reply('برای type=main یا sub، to_page را هم مشخص کن. مثال: to_page=2');
  }

  // ذخیره در state برای تأیید نهایی
  st = setState(userId,{
    type,
    from_chat_id,
    to_chat_id,
    from_page_id,
    to_page_id,
    label,
    emoji,
    base_travel_sec
  });

  // خلاصه برای تأیید
  const lines=[
    'خلاصه‌ی گیت جدید:',
    `• نوع: ${type}`,
    `• مبدا: ${st.from_chat_id} | صفحه: ${st.from_page_id}`,
    `• مقصد: ${st.to_chat_id} | صفحه: ${st.to_page_id}`,
    `• برچسب: ${st.label}`,
    `• ایموجی: ${st.emoji||'-'}`,
    `• زمان: ${st.base_travel_sec} ثانیه`
  ];
  return ctx.reply(
    lines.join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ ذخیره','lw:save')],
      [Markup.button.callback('❌ لغو','lw:cancel')]
    ])
  );
}

async function handleSave(ctx){
  const uId=ctx.from.id;
  const st=state(uId);
  if(!st) return ctx.reply('چیزی برای ذخیره کردن نیست. دوباره /lw_gate را بزن.');

  const gate={
    type: st.type,
    from_chat_id: `${st.from_chat_id}`,
    to_chat_id: st.to_chat_id ? `${st.to_chat_id}` : null,
    from_page_id: st.from_page_id,
    to_page_id: st.to_page_id,
    label: st.label,
    emoji: st.emoji || null,
    base_travel_sec: st.base_travel_sec,
    active: true,
    meta_json: null
  };

  try{
    await insertGate(gate);
    clearState(uId);
    return ctx.editMessageText('✅ گیت ذخیره شد.');
  }catch(e){
    return ctx.reply('❌ خطا در ذخیره‌ی گیت. بعداً لاگ سرور را چک کن.');
  }
}

function register(bot,config){
  // دستور اصلی ویزارد
  bot.command('link_wizard', async (ctx)=>{
    if(!onlyOwnerPV(config,ctx)) return;

    setState(ctx.from.id, { from_chat_id: null });
    await ctx.reply(
      '👋 خوش آمدی به ویزارد لینک.\n\n'+
      'این ویزارد بهت کمک می‌کند صفحه‌ها و مسیرها را راحت بسازی.\n\n'+
      'اول مشخص کن از کدام گروه می‌خواهی کار را شروع کنی.',
      kbCancel()
    );

    await hintSendChat(ctx);
  });

  // ساخت صفحه
  bot.command('lw_page', async (ctx)=>{
    const params = (ctx.message.text||'').split(' ').slice(1);
    await handlePageCommand(ctx,config,params);
  });

  // ساخت گیت
  bot.command('lw_gate', async (ctx)=>{
    const parts = (ctx.message.text||'').split(' ').slice(1);
    await handleGateCommand(ctx,config,parts);
  });

  // کال‌بک‌ها برای ذخیره/لغو
  bot.on('callback_query', async (ctx,next)=>{
    const data = ctx.callbackQuery?.data || '';
    const uId = ctx.from?.id;
    if(!uId) return next();

    if(data==='lw:cancel'){
      clearState(uId);
      try{ await ctx.editMessageText('🚫 ویزارد لغو شد.'); }catch{}
      return;
    }

    if(data==='lw:save'){
      await handleSave(ctx);
      return;
    }

    return next();
  });

  // اگر کاربر در میانه‌ی ویزارد بود و پیام متنی فرستاد، تشخیص دهیم در کدام مرحله است
  bot.on('message', async (ctx,next)=>{
    if(ctx.chat?.type!=='private') return next();
    const uId = ctx.from?.id;
    if(!uId) return next();
    const st = state(uId);
    if(!st) return next();

    // اگر از او خواسته بودیم گروه را معرفی کند (forward یا id)
    if(!st.from_chat_id && ctx.message){
      if(ctx.message.forward_from_chat){
        const c = ctx.message.forward_from_chat;
        if(c.type!=='group' && c.type!=='supergroup'){
          return ctx.reply('فوروارد باید از یک گروه یا سوپرگروپ باشد.');
        }
        setState(uId,{ from_chat_id: c.id });
        await ctx.reply(`✅ گروه انتخاب شد: ${c.title||c.id}`);
        await explainTypes(ctx);
        await listPages(ctx,c.id);
        return;
      }

      if(ctx.message.text){
        const txt = ctx.message.text.trim();
        if(/^-?\d+$/.test(txt)){
          const id = BigInt(txt); // آیدی عددی
          setState(uId,{ from_chat_id: id.toString() });
          await ctx.reply(`✅ گروه انتخاب شد: ${id.toString()}`);
          await explainTypes(ctx);
          await listPages(ctx,id.toString());
          return;
        }
      }

      return ctx.reply('لطفاً یک پیام از گروه مبدا فوروارد کن یا آیدی عددی آن را بفرست.');
    }

    return next();
  });
}

module.exports = { register };
