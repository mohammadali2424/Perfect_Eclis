// === RPG World Bot — Pages & Gates (main/sub) + Anti-Cheat + Freeze ===
// by: mj + jarvis

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Telegraf, Markup } = require('telegraf');
const NodeCache = require('node-cache');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = parseInt(process.env.OWNER_ID || '0', 10);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || '';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!BOT_TOKEN || !OWNER_ID || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ ENV ناقص: BOT_TOKEN, OWNER_ID, SUPABASE_URL, SUPABASE_KEY');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 9000 });
const supa = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const app = express(); app.use(express.json());

// === utils
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const nowIso = ()=>new Date().toISOString();
const humanize=(s)=>{ s=Math.max(1,Math.round(s)); if(s<60) return `${s} ثانیه`; const m=Math.floor(s/60),r=s%60; return r?`${m} دقیقه و ${r} ثانیه`:`${m} دقیقه`; };
const normalize=(s='')=>s.replace(/\u200c/g,'').replace(/[ي]/g,'ی').replace(/[ك]/g,'ک').replace(/[ـ]+/g,'').replace(/\s+/g,' ').trim();
const isTrigger=(t,word)=>new RegExp(`^#\\s*${word}(?:\\s|$)`).test(normalize(t).toLowerCase());
const parseDur=(txt='')=>{
  const m=String(txt).trim().match(/^(\d+)\s*(s|sec|m|min|h|hr)?$/i);
  if(!m) return null;
  const n=parseInt(m[1],10); const u=(m[2]||'m').toLowerCase();
  if(u==='s'||u==='sec') return n;
  if(u==='h'||u==='hr') return n*3600;
  return n*60; // default minutes
};

// === caches
const cache = new NodeCache({ stdTTL: 300, checkperiod: 120, maxKeys: 20000 });
const inFlightUser = new NodeCache({ stdTTL: 10, checkperiod: 15 }); // ضد کلیک‌های سریع
let ME_ID=null; (async()=>{ try{ ME_ID=(await bot.telegram.getMe()).id; }catch{} })();

const q=[]; let pumping=false;
const enqueue=fn=>new Promise(res=>{ q.push({fn,res}); if(!pumping) pump(); });
async function pump(){ pumping=true; while(q.length){ const {fn,res}=q.shift(); try{ res(await fn()); }catch(e){ res(Promise.reject(e)); } await sleep(80);} pumping=false; }
async function safeSend(chatId,text,extra={}) {
  try { return await enqueue(()=>bot.telegram.sendMessage(chatId,text,extra)); }
  catch (e) {
    const m=String(e.message||e);
    if(/429|timeout|ETELEGRAM/i.test(m)){ await sleep(600); try{ return await enqueue(()=>bot.telegram.sendMessage(chatId,text,extra)); }catch{} }
    throw e;
  }
}

const isOwner = (ctx)=>ctx.from?.id===OWNER_ID;
const replyNotOwner = async (ctx)=>{ try{ await ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده',{ reply_to_message_id: ctx.message?.message_id }); }catch{} };
const ensureOwner = (ctx)=>{ if(isOwner(ctx)) return true; replyNotOwner(ctx); return false; };

// === DB helpers
async function ensureAllowedChat(chatId){
  const k=`allowed:${chatId}`; const c=cache.get(k); if(c!==undefined) return c;
  try{
    const {data,error}=await supa.from('registered_chats').select('chat_id').eq('chat_id',`${chatId}`).maybeSingle();
    const ok=!error && !!data; cache.set(k,ok,600); return ok;
  }catch{ cache.set(k,false,120); return false; }
}
async function getChatState(chatId){
  const k=`rchat:${chatId}`; const c=cache.get(k); if(c) return c;
  const {data}=await supa.from('registered_chats').select('title,locked,locked_message,freeze_until').eq('chat_id',`${chatId}`).maybeSingle();
  const st={
    title: data?.title || `${chatId}`,
    locked: !!data?.locked,
    lmsg: data?.locked_message || 'این منطقه فعلاً بسته است.',
    freeze_until: data?.freeze_until ? new Date(data.freeze_until).getTime() : 0
  };
  cache.set(k,st,180); return st;
}
async function getPages(chatId){
  const k=`pages:${chatId}`; const c=cache.get(k); if(c) return c;
  const {data}=await supa.from('pages').select('id,title,body,order_index,active').eq('chat_id',`${chatId}`).order('order_index',{ascending:true}).order('title',{ascending:true}).limit(1000);
  const rows=(data||[]).filter(p=>p.active!==false);
  cache.set(k,rows,180); return rows;
}
async function getPageById(pageId){
  const k=`page:${pageId}`; const c=cache.get(k); if(c) return c;
  const {data}=await supa.from('pages').select('id,chat_id,title,body,order_index,active').eq('id',pageId).maybeSingle();
  if(data) cache.set(k,data,180);
  return data||null;
}
async function getGatesFromPage(pageId){
  const k=`gates:from:${pageId}`; const c=cache.get(k); if(c) return c;
  const {data}=await supa.from('gates')
    .select('id,type,from_chat_id,from_page_id,to_chat_id,to_page_id,label,emoji,base_travel_sec,active,order_index,section')
    .eq('from_page_id',pageId)
    .order('order_index',{ascending:true}).order('id',{ascending:true}).limit(1000);
  const rows=(data||[]).filter(g=>g.active!==false);
  cache.set(k,rows,180); return rows;
}
async function upsertPlayer(p){ await supa.from('players').upsert(p,{ onConflict:'user_id' }); }
async function getPlayer(userId){ const {data}=await supa.from('players').select('user_id,current_chat_id,current_page_id,status,updated_at').eq('user_id',userId).maybeSingle(); return data||null; }
async function getFirstPage(chatId){
  const pages=await getPages(chatId);
  return pages[0] || null;
}
async function setFreeze(chatId, seconds){
  const until=new Date(Date.now()+seconds*1000).toISOString();
  await supa.from('registered_chats').update({ freeze_until: until }).eq('chat_id',`${chatId}`);
  cache.del(`rchat:${chatId}`);
}
async function clearFreeze(chatId){
  await supa.from('registered_chats').update({ freeze_until: null }).eq('chat_id',`${chatId}`);
  cache.del(`rchat:${chatId}`);
}

// === helpers: page rendering
function pageNeighbors(pages, pageId){
  const idx = pages.findIndex(p=>p.id===pageId);
  if(idx<0) return {prev:null,next:null,index:-1,total:pages.length};
  return {
    prev: pages[idx-1]?.id || null,
    next: pages[idx+1]?.id || null,
    index: idx,
    total: pages.length
  };
}

async function buildPageViewForUser(chatId, pageId){
  const page = await getPageById(pageId);
  if(!page) return null;
  const gates = await getGatesFromPage(pageId);
  const pages = await getPages(chatId);
  const neigh = pageNeighbors(pages, pageId);

  const rows=[];
  for(const g of gates.slice(0,24)){
    const label = `${g.emoji||'🧭'} ${g.label} — ${humanize(g.base_travel_sec)}`;
    rows.push([Markup.button.callback(label, `gate:${g.id}:${g.type}:${g.base_travel_sec}`)]);
  }
  // nav row
  const nav = [];
  if(neigh.prev) nav.push(Markup.button.callback('◀️', `pnav:${chatId}:${neigh.prev}`));
  nav.push(Markup.button.callback(`${neigh.index+1}/${neigh.total}`, 'pnav:nop'));
  if(neigh.next) nav.push(Markup.button.callback('▶️', `pnav:${chatId}:${neigh.next}`));
  rows.push(nav);

  // eta button
  rows.push([Markup.button.callback('⏳ زمانِ باقی‌ماندهٔ من','pmenu:eta')]);

  const text = `📜 ${page.title}\n\n${page.body||'—'}`;
  return { text, kb: Markup.inlineKeyboard(rows,{columns:1}), pageId: page.id };
}

async function sendCurrentPagePV(userId, chatId){
  // 1) resolve player's current page or default
  let player = await getPlayer(userId);
  let pageId = null;
  if(player && `${player.current_chat_id}`===`${chatId}` && player.current_page_id){
    pageId = player.current_page_id;
  } else {
    const first = await getFirstPage(chatId);
    if(!first) return false;
    pageId = first.id;
    await upsertPlayer({ user_id:userId, current_chat_id:`${chatId}`, current_page_id: pageId, status:'idle', updated_at: nowIso() });
  }
  const view = await buildPageViewForUser(chatId, pageId);
  if(!view) return false;
  await safeSend(userId, view.text, view.kb);
  return true;
}

// === group admin / quarantine
async function isBotAdmin(chatId){
  const k=`admin:${chatId}`; const c=cache.get(k); if(c!==undefined) return c;
  try{ const me=await bot.telegram.getChatMember(chatId,ME_ID); const ok=['administrator','creator'].includes(me.status); cache.set(k,ok,600); return ok; }catch{ cache.set(k,false,120); return false; }
}
async function softKick(chatId,userId){
  try{
    if(!await isBotAdmin(chatId)) return false;
    try{ const m=await bot.telegram.getChatMember(chatId,userId); if(['left','kicked','creator'].includes(m.status)) return true; }catch{}
    await bot.telegram.banChatMember(chatId,userId);
    setTimeout(()=>bot.telegram.unbanChatMember(chatId,userId).catch(()=>{}),10_000);
    await sleep(60); return true;
  }catch{ return false; }
}
async function kickOthers(keepChatId,userId){
  const k='registered:list'; let regs=cache.get(k);
  if(!regs){ const {data}=await supa.from('registered_chats').select('chat_id').limit(5000); regs=data||[]; cache.set(k,regs,600); }
  for(const r of regs){ const cid=`${r.chat_id}`; if(cid===`${keepChatId}`) continue; await softKick(cid,userId); }
}

// === scheduler (sub moves local timers)
const timers=new Map();
function newMoveId(u,k){ return `${u}_${k}_${Date.now()}`; }

async function scheduleSubArrival(move){
  const delay=Math.max(0,new Date(move.arrive_at).getTime()-Date.now());
  if(delay>60*60*1000) return; // سقف یک ساعت برای در حافظه
  if(timers.has(move.move_id)) return;
  const id=setTimeout(async()=>{
    timers.delete(move.move_id);
    try{
      // finalize move
      const {data:m}=await supa.from('movements').select('state,to_chat_id,to_page_id,user_id').eq('move_id',move.move_id).maybeSingle();
      if(!m || m.state!=='scheduled') return;
      // set player state and page
      await supa.from('players').upsert({ user_id:m.user_id, current_chat_id:`${m.to_chat_id}`, current_page_id:m.to_page_id, status:'idle', updated_at: nowIso() }, { onConflict:'user_id' });
      await supa.from('movements').update({ state:'arrived' }).eq('move_id',move.move_id);

      // arrival message (mention)
      const mention = `[${m.user_id}](tg://user?id=${m.user_id})`; // تلگرام خودش اسم را جایگزین نمی‌کند؛ از منشن ساده با id استفاده می‌کنیم
      const page = await getPageById(m.to_page_id);
      const text = `🏁 ${mention} وارد **${page?.title||'اینجا'}** شد.`;
      try{ await bot.telegram.sendMessage(m.to_chat_id, text, { parse_mode:'Markdown' }); }catch{}
    }catch{}
  },delay);
  timers.set(move.move_id,id);
}

// === anti-cheat guards
async function hasActiveMove(userId){
  const {data}=await supa.from('movements').select('move_id,arrive_at,ticket_expires_at').eq('user_id',userId).eq('state','scheduled').order('departed_at',{ascending:false}).limit(1);
  const m=data&&data[0];
  if(!m) return false;
  // اگر موعد رسیده ولی هنوز به هر دلیلی finalize نشده، اجازه‌ی حرکت جدید ندهیم (تا scheduler/JR نهایی کند)
  return true;
}

async function canStartMove(chatId){
  const st = await getChatState(chatId);
  if(st.locked) return {ok:false, why: st.lmsg||'⛔️ منطقه قفل است'};
  if(st.freeze_until && Date.now() < st.freeze_until) return {ok:false, why: `❄️ این منطقه تا ${new Date(st.freeze_until).toLocaleString('fa-IR')} فریز است`};
  return {ok:true};
}

// === TRIGGERS
async function handleVorud(ctx){
  const chatId=`${ctx.chat?.id}`; const userId=ctx.from?.id; if(!chatId||!userId) return;
  const allowed=await ensureAllowedChat(chatId); if(!allowed) return; // بی‌صدا
  try{ await sendCurrentPagePV(userId,chatId); }catch{}
}
async function handleKhoroj(ctx){
  const u=ctx.message?.from; if(!u||u.is_bot) return;
  try{ await ctx.reply(`🧭┊سفر به سلامت ${u.first_name||''}`,{ reply_to_message_id: ctx.message.message_id }); }catch{}
}

bot.on('text', async (ctx,next)=>{
  if(ctx.chat?.type==='private') return next();
  const t=ctx.message?.text||'';
  if(isTrigger(t,'ورود')) return handleVorud(ctx);
  if(isTrigger(t,'خروج')) return handleKhoroj(ctx);
  return next();
});

// === COMMANDS (owner only ops)
bot.start((ctx)=>ctx.reply('نینجا در خدمت شماست 🥷🏻'));

bot.command('on', async (ctx)=>{ if(!ensureOwner(ctx))return;
  const id=`${ctx.chat.id}`, title=ctx.chat.title||'بدون عنوان';
  const {error}=await supa.from('registered_chats').upsert({chat_id:id,title,created_at:nowIso()},{onConflict:'chat_id'});
  cache.del(`allowed:${id}`); cache.del(`rchat:${id}`); cache.del(`pages:${id}`);
  if(error) return ctx.reply('❌ خطا در ثبت منطقه'); ctx.reply('✅ منطقه ثبت شد');
});

bot.command('off', async (ctx)=>{ if(!ensureOwner(ctx))return;
  const id=`${ctx.chat.id}`; await supa.from('registered_chats').delete().eq('chat_id',id);
  cache.del(`allowed:${id}`); cache.del(`rchat:${id}`); cache.del(`pages:${id}`);
  try{ await ctx.leaveChat(); }catch{}
});

bot.command('lock', async (ctx)=>{ if(!ensureOwner(ctx))return; const id=`${ctx.chat.id}`;
  await supa.from('registered_chats').update({locked:true}).eq('chat_id',id); cache.del(`rchat:${id}`); ctx.reply('⛔️ این منطقه قفل شد');
});
bot.command('unlock', async (ctx)=>{ if(!ensureOwner(ctx))return; const id=`${ctx.chat.id}`;
  await supa.from('registered_chats').update({locked:false}).eq('chat_id',id); cache.del(`rchat:${id}`); ctx.reply('✅ این منطقه باز شد');
});

bot.command('freeze', async (ctx)=>{ if(!ensureOwner(ctx))return;
  const parts=(ctx.message.text||'').trim().split(/\s+/); const arg=parts[1]||'10m';
  const secs=parseDur(arg); if(!secs) return ctx.reply('فرمت: /freeze 10m  یا 30s یا 1h');
  await setFreeze(`${ctx.chat.id}`, secs);
  ctx.reply(`❄️ این منطقه تا ${humanize(secs)} فریز شد (حرکت جدید ممنوع)`);
});
bot.command('unfreeze', async (ctx)=>{ if(!ensureOwner(ctx))return;
  await clearFreeze(`${ctx.chat.id}`); ctx.reply('🔥 فریز برداشته شد');
});

// VIP / free (همان قبل)
bot.command('vip', async (ctx)=>{ if(!ensureOwner(ctx))return;
  const t=ctx.message?.reply_to_message?.from; if(!t) return ctx.reply('روی پیام کاربر ریپلای کن بعد /vip بزن');
  await supa.from('vip_users').upsert({user_id:t.id,added_at:nowIso()},{onConflict:'user_id'});
  await supa.from('players').delete().eq('user_id',t.id);
  ctx.reply(`✅ ${t.first_name} VIP شد`);
});
bot.command('unvip', async (ctx)=>{ if(!ensureOwner(ctx))return;
  const t=ctx.message?.reply_to_message?.from; if(!t) return ctx.reply('روی پیام کاربر ریپلای کن بعد /unvip بزن');
  await supa.from('vip_users').delete().eq('user_id',t.id);
  ctx.reply(`✅ ${t.first_name} از VIP خارج شد`);
});
bot.command('free', async (ctx)=>{ if(!ensureOwner(ctx))return;
  const t=ctx.message?.reply_to_message?.from; if(!t) return ctx.reply('روی پیام کاربر ریپلای کن بعد /free بزن');
  await supa.from('players').delete().eq('user_id',t.id);
  ctx.reply(`✅ ${t.first_name} از قرنطینه/حرکت معلق خارج شد`);
});

// === link wizard — دوحالته (main/sub) مینیمال و پایدار
const wizard=new Map(); // uid -> state
const stOf=(uid)=>{ if(!wizard.has(uid)) wizard.set(uid,{step:0}); return wizard.get(uid); };
async function ensurePV(uid){ try{ await bot.telegram.sendChatAction(uid,'typing'); return true; }catch{ return false; } }

bot.command('link_wizard', async (ctx)=>{
  if(!ensureOwner(ctx)) return;
  const uid=ctx.from.id;
  const lastGroup = ctx.chat?.type!=='private' ? `${ctx.chat.id}` : null;
  if(!(await ensurePV(uid))) return ctx.reply('ابتدا در PV بات را /start کن.');
  const st=stOf(uid);
  st.step='chooseType';
  st.fromChatId = lastGroup;
  wizard.set(uid, st);
  const kb=Markup.inlineKeyboard([
    [Markup.button.callback('🔗 مسیر اصلی (بین گروهی)','wz:type:main')],
    [Markup.button.callback('🧭 مسیر فرعی (درون همین گروه)','wz:type:sub')],
    [Markup.button.callback('❌ لغو','wz:cancel')]
  ]);
  await safeSend(uid,'نوع مسیر را انتخاب کن:',kb);
  if(lastGroup && ctx.chat?.type!=='private'){ try{ await ctx.reply('ادامه‌ی ویزارد در PV شما انجام می‌شود.'); }catch{} }
});

const wzReply = async (ctx, text, kb) => {
  try { await ctx.editMessageText(text, kb); } catch { await safeSend(ctx.from.id, text, kb); }
  try { await ctx.answerCbQuery(); } catch {}
};

bot.action('wz:cancel', async (ctx)=>{ wizard.delete(ctx.from.id); await wzReply(ctx,'وِیزارد لغو شد.'); });

bot.action(/^wz:type:(main|sub)$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private' || !isOwner(ctx)) return;
  const st=stOf(ctx.from.id); st.type=ctx.match[1]; st.step='fromChat';
  if(!st.fromChatId){
    await wzReply(ctx,'مبدأ را انتخاب کن:',Markup.inlineKeyboard([
      [Markup.button.callback('📜 انتخاب از گروه‌های ثبت‌شده','wz:from:list:1')],
      [Markup.button.callback('❌ لغو','wz:cancel')]
    ]));
  } else {
    st.step='fromPage';
    await wzReply(ctx,`مبدأ: ${st.fromChatId}\nصفحهٔ مبدأ را انتخاب کن:`, Markup.inlineKeyboard([
      [Markup.button.callback('📄 از صفحات موجود','wz:from:page:list:1')],
      [Markup.button.callback('➕ ساخت صفحهٔ جدید','wz:from:page:new')],
      [Markup.button.callback('❌ لغو','wz:cancel')]
    ]));
  }
});

// صفحات/گروه‌ها — لیست‌های ساده
async function listRegistered(page=1,size=8){
  const k='reg:list:all'; let list=cache.get(k);
  if(!list){ const {data}=await supa.from('registered_chats').select('chat_id,title').order('title',{ascending:true}).limit(5000); list=data||[]; cache.set(k,list,300); }
  const pagesCount=Math.max(1,Math.ceil(list.length/size));
  const items=list.slice((page-1)*size,(page-1)*size+size);
  return {items, page, pagesCount};
}
bot.action(/^wz:from:list:(\d+)$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const p=parseInt(ctx.match[1],10)||1; const {items,page,pagesCount}=await listRegistered(p,8);
  const rows=items.map(it=>[Markup.button.callback(`${it.title||it.chat_id}`,`wz:from:set:${it.chat_id}`)]);
  rows.push([Markup.button.callback('◀️',`wz:from:list:${Math.max(1,page-1)}`),Markup.button.callback(`${page}/${pagesCount}`,'wz:nop'),Markup.button.callback('▶️',`wz:from:list:${Math.min(pagesCount,page+1)}`)]);
  rows.push([Markup.button.callback('❌ لغو','wz:cancel')]);
  await wzReply(ctx,'گروه مبدأ را انتخاب کن:',Markup.inlineKeyboard(rows,{columns:1}));
});
bot.action(/^wz:from:set:(-?\d{6,20})$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id); st.fromChatId=ctx.match[1]; st.step='fromPage';
  await wzReply(ctx,`مبدأ: ${st.fromChatId}\nصفحهٔ مبدأ را انتخاب کن:`, Markup.inlineKeyboard([
    [Markup.button.callback('📄 از صفحات موجود','wz:from:page:list:1')],
    [Markup.button.callback('➕ ساخت صفحهٔ جدید','wz:from:page:new')],
    [Markup.button.callback('❌ لغو','wz:cancel')]
  ]));
});

async function listPages(chatId,page=1,size=8){
  const list=await getPages(chatId);
  const pagesCount=Math.max(1,Math.ceil(list.length/size));
  const items=list.slice((page-1)*size,(page-1)*size+size);
  return {items, page, pagesCount};
}

bot.action(/^wz:from:page:list:(\d+)$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id); const p=parseInt(ctx.match[1],10)||1;
  const {items,page,pagesCount}=await listPages(st.fromChatId,p,8);
  const rows=items.map(it=>[Markup.button.callback(`${it.title}`,`wz:from:page:set:${it.id}`)]);
  rows.push([Markup.button.callback('◀️',`wz:from:page:list:${Math.max(1,page-1)}`),Markup.button.callback(`${page}/${pagesCount}`,'wz:nop'),Markup.button.callback('▶️',`wz:from:page:list:${Math.min(pagesCount,page+1)}`)]);
  rows.push([Markup.button.callback('➕ ساخت صفحهٔ جدید','wz:from:page:new')],[Markup.button.callback('❌ لغو','wz:cancel')]);
  await wzReply(ctx,'صفحهٔ مبدأ را انتخاب کن:',Markup.inlineKeyboard(rows,{columns:1}));
});

bot.action('wz:from:page:new', async (ctx)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id); st.step='fromPageTitle';
  await wzReply(ctx,'عنوان صفحهٔ مبدأ را بفرست (مثلاً «خیابان شهر باستانی»)', Markup.inlineKeyboard([[Markup.button.callback('❌ لغو','wz:cancel')]]));
});
bot.on('text', async (ctx,next)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return next();
  const st=wizard.get(ctx.from.id); if(!st) return next();
  if(st.step==='fromPageTitle'){
    st.fromPageTitle=(ctx.message.text||'').trim();
    st.step='fromPageBody';
    return safeSend(ctx.from.id,'متن/توضیح صفحهٔ مبدأ را بفرست (اختیاری، خالی هم می‌پذیریم)');
  }
  if(st.step==='fromPageBody'){
    st.fromPageBody=(ctx.message.text||'').trim();
    // order_index: انتهای لیست
    const pages=await getPages(st.fromChatId);
    const order=(pages[pages.length-1]?.order_index||0)+1;
    const {data:pg}=await supa.from('pages').insert({chat_id:st.fromChatId,title:st.fromPageTitle,body:st.fromPageBody,order_index:order,active:true}).select('id').single();
    cache.del(`pages:${st.fromChatId}`);
    st.fromPageId=pg.id; st.step='destChooser';
    if(st.type==='main'){
      return safeSend(ctx.from.id,'گروه مقصد را انتخاب کن:', Markup.inlineKeyboard([
        [Markup.button.callback('📜 از گروه‌های ثبت‌شده','wz:to:list:1')],
        [Markup.button.callback('❌ لغو','wz:cancel')]
      ]));
    }else{
      // sub: مقصد در همین گروه
      return safeSend(ctx.from.id,'صفحهٔ مقصد (در همین گروه) را انتخاب کن:', Markup.inlineKeyboard([
        [Markup.button.callback('📄 از صفحات موجود','wz:to:page:list:1')],
        [Markup.button.callback('➕ ساخت صفحهٔ جدید','wz:to:page:new')],
        [Markup.button.callback('❌ لغو','wz:cancel')]
      ]));
    }
  }
  if(st.step==='toPageTitle'){
    st.toPageTitle=(ctx.message.text||'').trim();
    st.step='toPageBody';
    return safeSend(ctx.from.id,'متن/توضیح صفحهٔ مقصد را بفرست (اختیاری)');
  }
  if(st.step==='toPageBody'){
    st.toPageBody=(ctx.message.text||'').trim();
    const tgtChat = st.type==='main' ? st.toChatId : st.fromChatId;
    const pages=await getPages(tgtChat);
    const order=(pages[pages.length-1]?.order_index||0)+1;
    const {data:pg}=await supa.from('pages').insert({chat_id:tgtChat,title:st.toPageTitle,body:st.toPageBody,order_index:order,active:true}).select('id').single();
    cache.del(`pages:${tgtChat}`);
    st.toPageId=pg.id; st.step='gateProps';
    return safeSend(ctx.from.id,'لیبل دکمهٔ مسیر را بفرست (مثلاً «ورود به زیرزمین»).');
  }
  if(st.step==='gateProps'){
    st.gateLabel=(ctx.message.text||'').trim();
    st.step='gateTime';
    return safeSend(ctx.from.id,'⏱ زمان مسیر (ثانیه) را بفرست. (مثلاً 300)');
  }
  if(st.step==='gateTime'){
    const t=parseInt((ctx.message.text||'').trim(),10); if(!Number.isFinite(t)||t<=0) return safeSend(ctx.from.id,'⛔️ عدد معتبر بفرست.');
    st.gateTime=t; st.step='confirm';
    const desc=`بررسی نهایی:\nنوع: ${st.type}\nfrom: ${st.fromChatId} / page=${st.fromPageId}\n`+(st.type==='main'?`to: ${st.toChatId} / page=${st.toPageId}\n`:`to: ${st.fromChatId} / page=${st.toPageId}\n`)+`label: ${st.gateLabel}\ntime: ${t}s`;
    return safeSend(ctx.from.id,desc,Markup.inlineKeyboard([[Markup.button.callback('✅ ایجاد','wz:confirm')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }
  return next();
});

bot.action(/^wz:from:page:set:(.+)$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id); st.fromPageId=ctx.match[1]; st.step='destChooser';
  if(st.type==='main'){
    return wzReply(ctx,'گروه مقصد را انتخاب کن:', Markup.inlineKeyboard([[Markup.button.callback('📜 از گروه‌های ثبت‌شده','wz:to:list:1')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }else{
    return wzReply(ctx,'صفحهٔ مقصد (در همین گروه) را انتخاب کن:', Markup.inlineKeyboard([[Markup.button.callback('📄 از صفحات موجود','wz:to:page:list:1')],[Markup.button.callback('➕ ساخت صفحهٔ جدید','wz:to:page:new')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }
});

bot.action(/^wz:to:list:(\d+)$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const p=parseInt(ctx.match[1],10)||1; const {items,page,pagesCount}=await listRegistered(p,8);
  const rows=items.map(it=>[Markup.button.callback(`${it.title||it.chat_id}`,`wz:to:set:${it.chat_id}`)]);
  rows.push([Markup.button.callback('◀️',`wz:to:list:${Math.max(1,page-1)}`),Markup.button.callback(`${page}/${pagesCount}`,'wz:nop'),Markup.button.callback('▶️',`wz:to:list:${Math.min(pagesCount,page+1)}`)]);
  rows.push([Markup.button.callback('❌ لغو','wz:cancel')]);
  await wzReply(ctx,'گروه مقصد را انتخاب کن:',Markup.inlineKeyboard(rows,{columns:1}));
});
bot.action(/^wz:to:set:(-?\d{6,20})$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id); st.toChatId=ctx.match[1]; st.step='toPage';
  await wzReply(ctx,`مقصد: ${st.toChatId}\nصفحهٔ مقصد را انتخاب کن:`, Markup.inlineKeyboard([
    [Markup.button.callback('📄 از صفحات موجود','wz:to:page:list:1')],
    [Markup.button.callback('➕ ساخت صفحهٔ جدید','wz:to:page:new')],
    [Markup.button.callback('❌ لغو','wz:cancel')]
  ]));
});

bot.action(/^wz:to:page:list:(\d+)$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id);
  const tgtChat = st.type==='main' ? st.toChatId : st.fromChatId;
  const p=parseInt(ctx.match[1],10)||1;
  const {items,page,pagesCount}=await listPages(tgtChat,p,8);
  const rows=items.map(it=>[Markup.button.callback(`${it.title}`,`wz:to:page:set:${it.id}`)]);
  rows.push([Markup.button.callback('◀️',`wz:to:page:list:${Math.max(1,page-1)}`),Markup.button.callback(`${page}/${pagesCount}`,'wz:nop'),Markup.button.callback('▶️',`wz:to:page:list:${Math.min(pagesCount,page+1)}`)]);
  rows.push([Markup.button.callback('➕ ساخت صفحهٔ جدید','wz:to:page:new')],[Markup.button.callback('❌ لغو','wz:cancel')]);
  await wzReply(ctx,'صفحهٔ مقصد را انتخاب کن:',Markup.inlineKeyboard(rows,{columns:1}));
});
bot.action('wz:to:page:new', async (ctx)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id); st.step='toPageTitle';
  await wzReply(ctx,'عنوان صفحهٔ مقصد را بفرست', Markup.inlineKeyboard([[Markup.button.callback('❌ لغو','wz:cancel')]]));
});
bot.action(/^wz:to:page:set:(.+)$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id); st.toPageId=ctx.match[1]; st.step='gateProps';
  await wzReply(ctx,'لیبل دکمهٔ مسیر را بفرست',Markup.inlineKeyboard([[Markup.button.callback('❌ لغو','wz:cancel')]]));
});

bot.action('wz:confirm', async (ctx)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const uid=ctx.from.id; const st=stOf(uid);
  if(!st.fromChatId || !st.fromPageId || !st.gateLabel || !st.gateTime) return ctx.answerCbQuery('ناقص است').catch(()=>{});
  const type = st.type==='main' ? 'main' : 'sub';
  const toChat = st.type==='main' ? st.toChatId : st.fromChatId;
  if(st.type==='main' && (!st.toChatId || !st.toPageId)) return ctx.answerCbQuery('مقصد ناقص').catch(()=>{});

  const gate = {
    type, from_chat_id: st.fromChatId, from_page_id: st.fromPageId,
    to_chat_id: toChat, to_page_id: st.toPageId,
    label: st.gateLabel, emoji:'🧭', base_travel_sec: parseInt(st.gateTime,10),
    active:true, order_index:0, section:null
  };
  await supa.from('gates').insert(gate);
  cache.del(`gates:from:${st.fromPageId}`);
  if(st.type==='main') cache.del(`gates:from:${st.toPageId}`);

  wizard.delete(uid);
  await wzReply(ctx,'✅ مسیر ساخته شد');
});

// === Page nav in PV
bot.action(/^pnav:(-?\d{6,20}):(.+)$/i, async (ctx)=>{
  const chatId=ctx.match[1]; const pageId=ctx.match[2];
  if(ctx.chat?.type!=='private') { try{ await ctx.answerCbQuery(); }catch{} return; }
  const view = await buildPageViewForUser(chatId,pageId);
  if(!view){ try{ await ctx.answerCbQuery('صفحه نامعتبر'); }catch{} return; }
  // نمایش فقط؛ current_page_id کاربر را تغییر نمی‌دهیم تا وقتی مسیری را انتخاب کند.
  try{ await ctx.editMessageText(view.text, view.kb); }catch{ await safeSend(ctx.from.id, view.text, view.kb); }
  try{ await ctx.answerCbQuery(); }catch{}
});
bot.action('pnav:nop', async (ctx)=>{ try{ await ctx.answerCbQuery(); }catch{} });

// === ETA PV
bot.action('pmenu:eta', async (ctx)=>{
  const uid=ctx.from.id;
  const {data:mv}=await supa.from('movements').select('arrive_at,state').eq('user_id',uid).eq('state','scheduled').order('departed_at',{ascending:false}).limit(1);
  const m=mv&&mv[0]; if(!m) return ctx.answerCbQuery('حرکتی در جریان نیست').catch(()=>{});
  const d=new Date(m.arrive_at).getTime()-Date.now(); if(d<=0) return ctx.answerCbQuery('به مقصد رسیدی (یا هر لحظه می‌رسی)').catch(()=>{});
  return ctx.answerCbQuery(`زمان باقی‌مانده: ${humanize(Math.round(d/1000))}`).catch(()=>{});
});

// === Gate click (main/sub) + Anti-cheat + Freeze
bot.action(/^gate:(.+):(main|sub):(\d+)$/i, async (ctx)=>{
  const gateId=ctx.match[1]; const gtype=ctx.match[2]; const etaSec=parseInt(ctx.match[3],10);
  const uid=ctx.from.id;
  // ضد کلیک تند
  if(inFlightUser.get(uid)) { try{ await ctx.answerCbQuery('در حال پردازش...'); }catch{} return; }
  inFlightUser.set(uid,1,5);

  const {data:g}=await supa.from('gates').select('id,type,from_chat_id,from_page_id,to_chat_id,to_page_id,label,base_travel_sec').eq('id',gateId).maybeSingle();
  if(!g){ try{ await ctx.answerCbQuery('مسیر نامعتبر'); }catch{} return; }

  // فریز/قفل؟
  const check = await canStartMove(`${g.from_chat_id}`);
  if(!check.ok){ try{ await ctx.answerCbQuery(check.why); }catch{} return; }

  // هم‌زمانی حرکت؟
  if(await hasActiveMove(uid)){ try{ await ctx.answerCbQuery('⏳ در حال حرکت هستی.'); }catch{} return; }

  // صفحه فعلی کاربر باید با from_page_id هم‌خوانی داشته باشد
  const player=await getPlayer(uid);
  if(!player || `${player.current_chat_id}`!==`${g.from_chat_id}` || player.current_page_id!==g.from_page_id){
    try{ await ctx.answerCbQuery('❌ برای این مسیر در صفحهٔ درستی نیستی. #ورود بزن.'); }catch{} return;
  }

  const depart = nowIso();
  const arrive = new Date(Date.now()+etaSec*1000).toISOString();
  const moveId = newMoveId(uid, gateId);

  if(gtype==='sub'){
    // حرکت درون‌گروهی؛ لینک نمی‌دیم
    await supa.from('players').upsert({ user_id:uid, current_chat_id:`${g.to_chat_id}`, current_page_id:g.from_page_id, status:'quarantined', updated_at:depart },{onConflict:'user_id'});
    await supa.from('movements').insert({
      move_id:moveId, user_id:uid, from_chat_id:`${g.from_chat_id}`, to_chat_id:`${g.to_chat_id}`,
      from_page_id:g.from_page_id, to_page_id:g.to_page_id,
      gate_id:gateId, departed_at:depart, arrive_at:arrive, state:'scheduled',
      invite_link:null, ticket_expires_at:null
    });

    scheduleSubArrival({ move_id: moveId, arrive_at: arrive });
    try{ await ctx.answerCbQuery(`حرکت شروع شد؛ ${humanize(etaSec)} تا رسیدن`); }catch{}
    return;
  }

  // main: بین‌گروهی با بلیت امن
  try{
    const link=await bot.telegram.createChatInviteLink(g.to_chat_id,{
      expire_date:Math.floor(Date.now()/1000)+300, member_limit:1, creates_join_request:true, name:`ticket-${uid}-${gateId}`
    });
    await supa.from('players').upsert({ user_id:uid, current_chat_id:`${g.to_chat_id}`, current_page_id:g.from_page_id, status:'quarantined', updated_at:depart },{onConflict:'user_id'});
    await supa.from('movements').insert({
      move_id:moveId, user_id:uid, from_chat_id:`${g.from_chat_id}`, to_chat_id:`${g.to_chat_id}`,
      from_page_id:g.from_page_id, to_page_id:g.to_page_id,
      gate_id:gateId, departed_at:depart, arrive_at:arrive, state:'scheduled',
      invite_link:link.invite_link, ticket_expires_at:new Date(Date.now()+5*60*1000).toISOString()
    });

    kickOthers(`${g.to_chat_id}`,uid).catch(()=>{});
    await bot.telegram.sendMessage(uid,'🎟️ بلیت مقصد آماده شد.\n\nبرای ورود کلیک کن:', Markup.inlineKeyboard([[Markup.button.url('ورود به مقصد',link.invite_link)]]));
    try{ await ctx.answerCbQuery('لینک در PV ارسال شد'); }catch{}
  }catch(e){
    try{ await ctx.answerCbQuery('🚫 ایجاد لینک ممکن نشد'); }catch{}
  }
});

// === Join Request — ضد تقلب ورود زودهنگام + فرود روی صفحهٔ مقصد
bot.on('chat_join_request', async (ctx)=>{
  try{
    const req=ctx.update.chat_join_request; const userId=req.from.id; const chatId=`${req.chat.id}`;
    const st=await getChatState(chatId);
    if(st.locked){ await ctx.declineChatJoinRequest(userId); return; }

    const {data}=await supa.from('movements').select('move_id,invite_link,state,arrive_at,ticket_expires_at,gate_id,to_page_id').eq('user_id',userId).eq('to_chat_id',chatId).eq('state','scheduled').order('departed_at',{ascending:false}).limit(1);
    const mv=data&&data[0]; if(!mv){ await ctx.declineChatJoinRequest(userId); return; }

    const notExpired=new Date(mv.ticket_expires_at)>new Date();
    const nowOk = new Date(mv.arrive_at) <= new Date(); // اگر زود کلیک کرده باشد، تأیید نکن
    const linkOk=(req.invite_link?.invite_link||'')===mv.invite_link;

    if(notExpired && nowOk && linkOk){
      await ctx.approveChatJoinRequest(userId);
      // ست صفحهٔ مقصد
      await supa.from('players').upsert({ user_id:userId, current_chat_id:chatId, current_page_id:mv.to_page_id, status:'idle', updated_at: nowIso() },{onConflict:'user_id'});
      await supa.from('movements').update({ state:'arrived' }).eq('move_id',mv.move_id);

      // پیغام خوش‌آمد کوتاه
      const page = await getPageById(mv.to_page_id);
      try{ await safeSend(chatId, `🎴 خوش آمدی، [${userId}](tg://user?id=${userId}) — اکنون در **${page?.title||'اینجا'}** هستی.`, { parse_mode:'Markdown' }); }catch{}
    } else {
      await ctx.declineChatJoinRequest(userId);
      // اگر زود زده:
      if(new Date(mv.arrive_at) > new Date()){
        const wait = Math.max(1, Math.round((new Date(mv.arrive_at).getTime()-Date.now())/1000));
        try{ await bot.telegram.sendMessage(userId, `⏳ هنوز زود است؛ ${humanize(wait)} دیگر تلاش کن.`); }catch{}
      }
    }
  }catch{}
});

// === only owner may add bot
bot.on('my_chat_member', async (ctx)=>{
  try{
    const ns=ctx.update.my_chat_member?.new_chat_member?.status;
    const adder=ctx.update.my_chat_member?.from?.id;
    const chatId=ctx.chat?.id;
    if(ns && ['member','administrator'].includes(ns)){
      if(adder!==OWNER_ID){
        try{ await bot.telegram.sendMessage(chatId,'این ربات متعلق به مجموعه اکلیس است ، شما حق استفاده از آنها رو ندارین ، حدتو بدون'); }catch{}
        try{ await bot.telegram.leaveChat(chatId); }catch{}
      }
    }
  }catch{}
});

// === keepalive & webhook (بدون .catch روی await)
function startPing(){ if(!RENDER_URL) return; const url=RENDER_URL; setInterval(()=>axios.head(`${url}/ping`).catch(()=>{}), 13*60*1000+59*1000); }
app.get('/ping',(_req,res)=>res.status(200).json({ok:true}));
app.use(bot.webhookCallback('/webhook'));
app.get('/',(_req,res)=>res.send('<h3>RPG World Bot</h3>'));

app.listen(PORT, async ()=>{
  console.log('🚀 Bot on',PORT); startPing();
  try{
    await bot.telegram.deleteWebhook({ drop_pending_updates:true });
    if(RENDER_URL){ const url=`${RENDER_URL}/webhook`; await bot.telegram.setWebhook(url); console.log('✅ Webhook:',url); }
    else { await bot.launch(); console.log('✅ Long polling'); }
  }catch(e){ console.log('Startup warn:', e.message); }
});

process.on('unhandledRejection', e=>console.log('Unhandled:', e?.message||e));
