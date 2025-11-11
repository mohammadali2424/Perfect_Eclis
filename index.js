// RPG World Bot — stable callbacks + proper arrival announce + delayed kick + join-request hardening
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
  console.error('❌ ENV ناقص: BOT_TOKEN, OWNER_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 9000 });
const supa = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const app = express(); app.use(express.json());

let ME_ID = null;
(async () => { try { ME_ID = (await bot.telegram.getMe()).id; } catch { ME_ID = null; } })();

const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const nowIso = ()=>new Date().toISOString();
const humanize=(s)=>{ s=Math.max(1,Math.round(s)); if(s<60) return `${s} ثانیه`; const m=Math.floor(s/60),r=s%60; return r?`${m} دقیقه و ${r} ثانیه`:`${m} دقیقه`; };
const normalize=(s='')=>s.replace(/\u200c/g,'').replace(/[ي]/g,'ی').replace(/[ك]/g,'ک').replace(/[ـ]+/g,'').replace(/\s+/g,' ').trim();
const isTrigger=(t,word)=>new RegExp(`^#\\s*${word}(?:\\s|$)`).test(normalize(t).toLowerCase());
const parseDur=(txt='')=>{ const m=String(txt).trim().match(/^(\d+)\s*(s|sec|m|min|h|hr)?$/i); if(!m) return null; const n=parseInt(m[1],10); const u=(m[2]||'m').toLowerCase(); if(u==='s'||u==='sec') return n; if(u==='h'||u==='hr') return n*3600; return n*60; };

// --- caches
const apiQ=[]; let pumping=false;
const enqueue=fn=>new Promise((res)=>{ apiQ.push({fn,res}); if(!pumping) pump(); });
async function pump(){ pumping=true; while(apiQ.length){ const {fn,res}=apiQ.shift(); try{ res(await fn()); }catch(e){ res(Promise.reject(e)); } await sleep(80);} pumping=false; }
async function safeSend(chatId,text,extra={}){ try{ return await enqueue(()=>bot.telegram.sendMessage(chatId,text,extra)); }catch(e){ if(/429|timeout|ETELEGRAM/i.test(String(e.message||e))){ await sleep(600); try{ return await enqueue(()=>bot.telegram.sendMessage(chatId,text,extra)); }catch{} } throw e; } }

const cache = new NodeCache({ stdTTL: 180, checkperiod: 120, maxKeys: 20000 });
const inFlightUser = new NodeCache({ stdTTL: 8, checkperiod: 15 });
const cbMap = new NodeCache({ stdTTL: 600, checkperiod: 120, maxKeys: 50000 });

const randToken=(n=10)=>{ const a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'; let s=''; for(let i=0;i<n;i++) s+=a[Math.floor(Math.random()*a.length)]; return s; };
const putTok=(p,pre)=>{ const t=randToken(10); cbMap.set(`${pre}:${t}`,p); return `${pre}:${t}`; };
const getTok=(pre,t)=>cbMap.get(`${pre}:${t}`)||null;

// --- DB helpers
async function ensureAllowedChat(chatId){
  const k=`allowed:${chatId}`; const c=cache.get(k); if(c!==undefined) return c;
  try{ const {data,error}=await supa.from('registered_chats').select('chat_id').eq('chat_id',`${chatId}`).maybeSingle(); const ok=!error && !!data; cache.set(k,ok,600); return ok; }catch{ cache.set(k,false,120); return false; }
}
async function getChatState(chatId){
  const k=`rchat:${chatId}`; const c=cache.get(k); if(c) return c;
  const {data}=await supa.from('registered_chats').select('title,locked,locked_message,freeze_until').eq('chat_id',`${chatId}`).maybeSingle();
  const st={ title:data?.title||`${chatId}`, locked:!!data?.locked, lmsg:data?.locked_message||'این منطقه فعلاً بسته است.', freeze_until:data?.freeze_until?new Date(data.freeze_until).getTime():0 };
  cache.set(k,st,180); return st;
}
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

async function getPages(chatId){
  const k=`pages:${chatId}`; const c=cache.get(k); if(c) return c;
  const {data,error}=await supa.from('pages').select('id,chat_id,title,body,order_index,active,meta_json').eq('chat_id',`${chatId}`).order('order_index',{ascending:true}).order('title',{ascending:true}).limit(2000);
  if(error){ cache.set(k,[],60); return []; }
  const rows=(data||[]).filter(p=>p.active!==false);
  cache.set(k,rows,180); return rows;
}
async function getPageById(pageId){
  const k=`page:${pageId}`; const c=cache.get(k); if(c) return c;
  const {data}=await supa.from('pages').select('id,chat_id,title,body,order_index,active,meta_json').eq('id',pageId).maybeSingle();
  if(data) cache.set(k,data,180);
  return data||null;
}
async function getGatesFromPage(pageId){
  const k=`gates:from:${pageId}`; const c=cache.get(k); if(c) return c;
  const {data}=await supa.from('gates').select('id,type,from_chat_id,from_page_id,to_chat_id,to_page_id,label,emoji,base_travel_sec,active,order_index,section').eq('from_page_id',pageId).order('order_index',{ascending:true}).order('id',{ascending:true}).limit(2000);
  const rows=(data||[]).filter(g=>g.active!==false);
  cache.set(k,rows,180); return rows;
}
async function upsertPlayer(p){ await supa.from('players').upsert(p,{ onConflict:'user_id' }); }
async function getPlayer(userId){ const {data}=await supa.from('players').select('user_id,current_chat_id,current_page_id,status,updated_at,pending_credit_sec').eq('user_id',userId).maybeSingle(); return data||null; }
async function getFirstPage(chatId){ const pages=await getPages(chatId); return pages[0] || null; }

const newMoveId=(u,k)=>`${u}_${k}_${Date.now()}`;

// --- announce helper (یکجا هماهنگ)
async function announceEnter(chatId, pageTitle, userId){
  try{
    const mention = `[${userId}](tg://user?id=${userId})`;
    await safeSend(chatId, `پلیر ${mention} وارد ${pageTitle} شد`, { parse_mode:'Markdown' });
  }catch{}
}

// --- Link pool
const invitePool = new Map();
async function getPooledJoinRequestLink(toChatId) {
  const now = Date.now();
  const it = invitePool.get(toChatId);
  if (it && it.expireAtTs - now > 45_000) return it.link;
  const link = await bot.telegram.createChatInviteLink(toChatId, {
    expire_date: Math.floor((now + 5 * 60_000) / 1000),
    member_limit: 0,
    creates_join_request: true,
    name: `pool-${Math.floor(now/1000)}`
  });
  invitePool.set(toChatId, { link, expireAtTs: now + 5 * 60_000 });
  return link;
}
setInterval(()=>{ const now=Date.now(); for(const [k,v] of invitePool.entries()){ if(v.expireAtTs<=now) invitePool.delete(k); }}, 60_000);

// --- build views
function neighbors(pages,pageId){ const i=pages.findIndex(p=>p.id===pageId); return {prev:pages[i-1]?.id||null,next:pages[i+1]?.id||null,index:i,total:pages.length}; }

function putGateToken(payload){ return putTok(payload, 'g'); }
function getGateToken(t){ return getTok('g',t); }

function putCancelToken(payload){ return putTok(payload, 'c'); }
function getCancelToken(t){ return getTok('c',t); }

function putMicroToken(payload){ return putTok(payload,'m'); }
function getMicroToken(t){ return getTok('m',t); }

async function buildMicroView(page, currentKey){
  const micro = page?.meta_json?.micro;
  if(!micro) return null;
  const key = currentKey || micro.start;
  const node = micro.nodes?.[key]; if(!node) return null;
  const rows=[];
  for(const btn of (node.buttons||[]).slice(0,24)){
    const tok = putMicroToken({ page_id: page.id, next_key: btn.goto, eta: btn.eta||0, chat_id: page.chat_id, node_title: (micro.nodes?.[btn.goto]?.title)||btn.goto });
    rows.push([ Markup.button.callback(btn.label, `m:${tok.split(':')[1]}`) ]);
  }
  return { text:`📜 ${node.title}`, kb: Markup.inlineKeyboard(rows,{columns:1}), nodeTitle: node.title };
}

async function buildPageView(chatId,pageId){
  const page = await getPageById(pageId); if(!page) return null;
  // اگر micro دارد، همان را برگردان (لیست گیت‌ها را در صفحهٔ micro نمی‌چینیم)
  const microView = await buildMicroView(page,null);
  if(microView) return microView;

  const gates = await getGatesFromPage(pageId);
  const pages = await getPages(chatId);
  const n = neighbors(pages,pageId);
  const rows=[];
  for(const g of gates.slice(0,24)){
    const label = `${g.emoji||'🧭'} ${g.label} — ${humanize(g.base_travel_sec)}`;
    const tok = putGateToken({ gate_id:g.id, type:g.type, eta:g.base_travel_sec });
    rows.push([Markup.button.callback(label, `g:${tok.split(':')[1]}`)]);
  }
  const nav=[];
  if(n.prev) nav.push(Markup.button.callback('◀️',`pnav:${chatId}:${n.prev}`));
  nav.push(Markup.button.callback(`${n.index+1}/${n.total}`,'pnav:nop'));
  if(n.next) nav.push(Markup.button.callback('▶️',`pnav:${chatId}:${n.next}`));
  rows.push(nav);
  rows.push([Markup.button.callback('⏳ زمانِ باقی‌ماندهٔ من','pmenu:eta')]);
  return { text:`📜 ${page.title}\n\nمسیر های شما :`, kb: Markup.inlineKeyboard(rows,{columns:1}), nodeTitle: page.title };
}

async function sendCurrentPagePV(userId, chatId){
  let player = await getPlayer(userId);
  let pageId = null;
  if(player && `${player.current_chat_id}`===`${chatId}` && player.current_page_id){
    pageId = player.current_page_id;
  } else {
    const first = await getFirstPage(chatId); if(!first) return false;
    pageId = first.id;
    await upsertPlayer({ user_id:userId, current_chat_id:`${chatId}`, current_page_id: pageId, status:'idle', updated_at: nowIso() });
  }
  const view = await buildPageView(chatId,pageId);
  if(!view) return false;
  await safeSend(userId, view.text, view.kb);
  return true;
}

// --- movements/arrivals
const timers=new Map();
function scheduleSubArrival(move){
  const delay=Math.max(0,new Date(move.arrive_at).getTime()-Date.now());
  if(delay>60*60*1000) return;
  if(timers.has(move.move_id)) return;
  const id=setTimeout(()=>{ timers.delete(move.move_id); queueArrivalEvt({ move_id: move.move_id }); }, delay);
  timers.set(move.move_id,id);
}
const arrQ=[]; let arrTimer=null;
function queueArrivalEvt(evt){ arrQ.push(evt); if(!arrTimer) arrTimer=setTimeout(flushArrivals,400); }
async function flushArrivals(){
  const batch = arrQ.splice(0, arrQ.length); arrTimer=null;
  if(!batch.length) return;
  const ids = batch.map(b=>b.move_id);
  try{
    const {data:updated,error}=await supa.from('movements').update({state:'arrived'}).in('move_id',ids).eq('state','scheduled').select('move_id,to_chat_id,to_page_id,user_id');
    if(error||!updated?.length) return;

    const rows = updated.map(u=>({ user_id:u.user_id, current_chat_id:`${u.to_chat_id}`, current_page_id:u.to_page_id, status:'idle', updated_at:nowIso() }));
    await supa.from('players').upsert(rows,{ onConflict:'user_id' });

    for(const u of updated){
      // اعلان «پلیر ... وارد ... شد» فقط وقتی عضو واقعی است
      try{
        const cm=await bot.telegram.getChatMember(u.to_chat_id,u.user_id);
        if(!['member','administrator','creator'].includes(cm.status)) continue;
        const page = await getPageById(u.to_page_id);
        await announceEnter(u.to_chat_id, page?.title||'اینجا', u.user_id);
        // حالا حذف از بقیه گروه‌ها
        kickOthers(`${u.to_chat_id}`, u.user_id).catch(()=>{});
      }catch{}
    }
  }catch{}
}

async function finalizeDueMoves(userId){
  try{
    const {data}=await supa.from('movements').select('move_id,arrive_at,state').eq('user_id',userId).eq('state','scheduled').lte('arrive_at',nowIso()).limit(50);
    for(const m of (data||[])) queueArrivalEvt({move_id:m.move_id});
  }catch{}
}
async function hasActiveMove(userId){
  const {data}=await supa.from('movements').select('move_id,departed_at').eq('user_id',userId).eq('state','scheduled').order('departed_at',{ascending:false}).limit(1);
  return data && data[0];
}
async function canStartMove(chatId){
  const st=await getChatState(chatId);
  if(st.locked) return {ok:false, why: st.lmsg||'⛔️ منطقه قفل است'};
  if(st.freeze_until && Date.now()<st.freeze_until) return {ok:false, why:'❄️ این منطقه موقتاً فریز است'};
  return {ok:true};
}

// --- triggers
async function handleVorud(ctx){
  const chatId=`${ctx.chat?.id}`; const userId=ctx.from?.id; if(!chatId||!userId) return;
  const allowed=await ensureAllowedChat(chatId); if(!allowed) return;
  await finalizeDueMoves(userId);
  await sendCurrentPagePV(userId,chatId).catch(()=>{});
}
async function handleKhoroj(ctx){
  const u=ctx.message?.from; if(!u||u.is_bot) return;
  await ctx.reply(`🧭┊سفر به سلامت ${u.first_name||''}`,{ reply_to_message_id: ctx.message.message_id }).catch(()=>{});
}
bot.on('text', async (ctx,next)=>{
  if(ctx.chat?.type==='private') return next();
  const t=ctx.message?.text||'';
  if(isTrigger(t,'ورود')) return handleVorud(ctx);
  if(isTrigger(t,'خروج')) return handleKhoroj(ctx);
  return next();
});

// --- commands (owner)
const isOwner=(ctx)=>ctx.from?.id===OWNER_ID;
const replyNotOwner=(ctx)=>ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده',{ reply_to_message_id: ctx.message?.message_id }).catch(()=>{});
const ensureOwner=(ctx)=>{ if(isOwner(ctx)) return true; replyNotOwner(ctx); return false; };

bot.start((ctx)=>ctx.reply('نینجا در خدمت شماست 🥷🏻'));

bot.command('on', async (ctx)=>{ if(!ensureOwner(ctx))return;
  const id=`${ctx.chat.id}`, title=ctx.chat.title||'بدون عنوان';
  const {error}=await supa.from('registered_chats').upsert({chat_id:id,title,created_at:nowIso()},{onConflict:'chat_id'});
  cache.del(`allowed:${id}`); cache.del(`rchat:${id}`); cache.del(`pages:${id}`);
  if(error) return ctx.reply('❌ خطا در ثبت منطقه');
  ctx.reply('✅ منطقه ثبت شد');
});
bot.command('off', async (ctx)=>{ if(!ensureOwner(ctx))return;
  const id=`${ctx.chat.id}`; await supa.from('registered_chats').delete().eq('chat_id',id);
  cache.del(`allowed:${id}`); cache.del(`rchat:${id}`); cache.del(`pages:${id}`);
  ctx.leaveChat().catch(()=>{});
});
bot.command('lock', async (ctx)=>{ if(!ensureOwner(ctx))return; const id=`${ctx.chat.id}`;
  await supa.from('registered_chats').update({locked:true}).eq('chat_id',id); cache.del(`rchat:${id}`); ctx.reply('⛔️ این منطقه قفل شد');
});
bot.command('unlock', async (ctx)=>{ if(!ensureOwner(ctx))return; const id=`${ctx.chat.id}`;
  await supa.from('registered_chats').update({locked:false}).eq('chat_id',id); cache.del(`rchat:${id}`); ctx.reply('✅ این منطقه باز شد');
});
bot.command('freeze', async (ctx)=>{ if(!ensureOwner(ctx))return;
  const parts=(ctx.message.text||'').trim().split(/\s+/); const arg=parts[1]||'10m';
  const secs=parseDur(arg); if(!secs) return ctx.reply('فرمت: /freeze 10m | 30s | 1h');
  const until=new Date(Date.now()+secs*1000).toISOString();
  await supa.from('registered_chats').update({ freeze_until: until }).eq('chat_id',`${ctx.chat.id}`);
  cache.del(`rchat:${ctx.chat.id}`);
  ctx.reply(`❄️ این منطقه تا ${humanize(secs)} فریز شد`);
});
bot.command('unfreeze', async (ctx)=>{ if(!ensureOwner(ctx))return;
  await supa.from('registered_chats').update({ freeze_until: null }).eq('chat_id',`${ctx.chat.id}`);
  cache.del(`rchat:${ctx.chat.id}`); ctx.reply('🔥 فریز برداشته شد');
});
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
  ctx.reply(`✅ ${t.first_name} آزاد شد`);
});

// --- PV nav & ETA
bot.action(/^pnav:(-?\d{6,20}):(.+)$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private') { return ctx.answerCbQuery().catch(()=>{}); }
  const chatId=ctx.match[1]; const pageId=ctx.match[2];
  const page = await getPageById(pageId);
  const view = await buildPageView(chatId,pageId);
  if(!view) return ctx.answerCbQuery('صفحه نامعتبر').catch(()=>{});
  try{ await ctx.editMessageText(view.text, view.kb); }catch{ await safeSend(ctx.from.id, view.text, view.kb); }
  await ctx.answerCbQuery().catch(()=>{});
});
bot.action('pnav:nop', async (ctx)=>ctx.answerCbQuery().catch(()=>{}));
bot.action('pmenu:eta', async (ctx)=>{
  const uid=ctx.from.id;
  const {data}=await supa.from('movements').select('move_id,arrive_at,departed_at,state').eq('user_id',uid).eq('state','scheduled').order('departed_at',{ascending:false}).limit(1);
  const m=data&&data[0]; if(!m) return ctx.answerCbQuery('حرکتی در جریان نیست').catch(()=>{});
  const d=new Date(m.arrive_at).getTime()-Date.now();
  if(d<=0){ await finalizeDueMoves(uid); return ctx.answerCbQuery('به مقصد رسیدی (یا هر لحظه می‌رسی)').catch(()=>{}); }
  return ctx.answerCbQuery(`زمان باقی‌مانده: ${humanize(Math.round(d/1000))}`).catch(()=>{});
});

// --- micro routes (ریزمسیر)
bot.action(/^m:([A-Za-z0-9_-]{6,18})$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private') return ctx.answerCbQuery().catch(()=>{});
  const payload = getMicroToken(ctx.match[0]); if(!payload) return ctx.answerCbQuery('دکمه منقضی است. #ورود را بزن.').catch(()=>{});
  const { page_id, next_key, eta, chat_id, node_title } = payload;

  // حس زمان (بدون DB write)
  if(eta && eta>0){ await ctx.answerCbQuery(`⏳ ${humanize(eta)}`, true).catch(()=>{}); await sleep(Math.min(eta*1000, 15000)); }

  const page = await getPageById(page_id);
  const v = await buildMicroView(page, next_key);
  if(v){
    try{ await ctx.editMessageText(v.text, v.kb); }catch{ await safeSend(ctx.from.id, v.text, v.kb); }
    // اعلان داخل گروه فعلی:
    await announceEnter(`${chat_id}`, v.nodeTitle || node_title || 'اینجا', ctx.from.id);
  } else {
    await ctx.answerCbQuery('گره نامعتبر').catch(()=>{});
  }
});

// --- gate clicks (اصلی/فرعی)
bot.action(/^g:([A-Za-z0-9_-]{6,18})$/i, async (ctx)=>{
  const payload = getGateToken(ctx.match[0]);
  if(!payload){ return ctx.answerCbQuery('دکمه منقضی است. #ورود را بزن.').catch(()=>{}); }

  const { gate_id, type:gtype, eta:baseEta } = payload;
  const uid=ctx.from.id;

  if(inFlightUser.get(uid)) return ctx.answerCbQuery('در حال پردازش…').catch(()=>{});
  inFlightUser.set(uid,1,5);

  const {data:g}=await supa.from('gates').select('id,type,from_chat_id,from_page_id,to_chat_id,to_page_id,label,base_travel_sec').eq('id',gate_id).maybeSingle();
  if(!g) return ctx.answerCbQuery('مسیر نامعتبر').catch(()=>{});

  const chk=await canStartMove(`${g.from_chat_id}`); if(!chk.ok) return ctx.answerCbQuery(chk.why).catch(()=>{});

  const has=await hasActiveMove(uid); if(has) return ctx.answerCbQuery('⏳ در حال حرکت هستی. ابتدا «لغو حرکت» را بزن.').catch(()=>{});

  const player=await getPlayer(uid);
  const credit=Math.max(0, parseInt(player?.pending_credit_sec||0,10)||0);
  const etaSec=Math.max(10, (parseInt(baseEta,10)||g.base_travel_sec) - credit);

  const depart=nowIso();
  const arrive=new Date(Date.now()+etaSec*1000).toISOString();
  const moveId=newMoveId(uid, gate_id);
  if(credit>0) await supa.from('players').update({ pending_credit_sec:0 }).eq('user_id',uid);

  if(gtype==='sub'){
    await supa.from('players').upsert({ user_id:uid, current_chat_id:`${g.to_chat_id}`, current_page_id:g.from_page_id, status:'quarantined', updated_at:depart },{onConflict:'user_id'});
    await supa.from('movements').insert({
      move_id:moveId, user_id:uid, from_chat_id:`${g.from_chat_id}`, to_chat_id:`${g.to_chat_id}`,
      from_page_id:g.from_page_id, to_page_id:g.to_page_id, gate_id:gate_id,
      departed_at:depart, arrive_at:arrive, state:'scheduled', invite_link:null, ticket_expires_at:null
    });
    scheduleSubArrival({ move_id: moveId, arrive_at: arrive });

    const cancelTok = putCancelToken({ move_id: moveId, from_chat_id: `${g.from_chat_id}` });
    await ctx.answerCbQuery('حرکتت ثبت شد').catch(()=>{});
    await safeSend(uid, `شما درحال حرکت هستی…\n\nمسیر شما به سمت «${(await getPageById(g.to_page_id))?.title||'مقصد'}» است.\nمدت مسیر: ${humanize(etaSec)}`,
      Markup.inlineKeyboard([[Markup.button.callback('❌ لغو حرکت', `c:${cancelTok.split(':')[1]}`)]])
    ).catch(()=>{});
    return;
  }

  // main: فقط بلیت می‌سازیم (Join Request) — هیچ Kick پیش از موعد
  let pooledLink;
  try { pooledLink = await getPooledJoinRequestLink(g.to_chat_id); }
  catch(e){ console.log('invitePool err', e?.message||e); return ctx.answerCbQuery('🚫 ایجاد لینک ممکن نشد (ادمین/Join Request؟)').catch(()=>{}); }

  await supa.from('players').upsert({ user_id:uid, current_chat_id:`${g.to_chat_id}`, current_page_id:g.from_page_id, status:'quarantined', updated_at:depart },{onConflict:'user_id'});
  await supa.from('movements').insert({
    move_id:moveId, user_id:uid, from_chat_id:`${g.from_chat_id}`, to_chat_id:`${g.to_chat_id}`,
    from_page_id:g.from_page_id, to_page_id:g.to_page_id, gate_id:gate_id,
    departed_at:depart, arrive_at:arrive, state:'scheduled',
    invite_link:null, ticket_expires_at:new Date(Date.now()+5*60*1000).toISOString()
  });

  const destPage = await getPageById(g.to_page_id);
  const cancelTok = putCancelToken({ move_id: moveId, from_chat_id: `${g.from_chat_id}` });
  await bot.telegram.sendMessage(
    uid,
    `شما درحال حرکت هستی…\n\nمسیر شما به سمت «${destPage?.title||'مقصد'}» است.\nمدت مسیر: ${humanize(etaSec)}\n\nوقتی زمانت رسید، روی دکمه بزن:`,
    Markup.inlineKeyboard([
      [Markup.button.url('ورود به مقصد', pooledLink.invite_link)],
      [Markup.button.callback('❌ لغو حرکت', `c:${cancelTok.split(':')[1]}`)]
    ])
  ).catch(()=>{});
  await ctx.answerCbQuery('بلیت در PV ارسال شد').catch(()=>{});
});

// --- cancel move
bot.action(/^c:([A-Za-z0-9_-]{6,18})$/i, async (ctx)=>{
  const payload = getCancelToken(ctx.match[0]); if(!payload) return ctx.answerCbQuery('منقضی شده').catch(()=>{});
  const { move_id, from_chat_id } = payload; const uid=ctx.from.id;
  const {data,error}=await supa.from('movements').select('move_id,user_id,departed_at,state').eq('move_id',move_id).eq('user_id',uid).eq('state','scheduled').maybeSingle();
  if(error||!data) return ctx.answerCbQuery('حرکتی برای لغو نیست').catch(()=>{});
  const elapsedSec=Math.max(0, Math.round((Date.now()-new Date(data.departed_at).getTime())/1000));
  await supa.from('movements').update({state:'cancelled'}).eq('move_id',move_id);
  await supa.from('players').upsert({ user_id:uid, pending_credit_sec:elapsedSec, updated_at:nowIso(), current_chat_id:`${from_chat_id}` },{onConflict:'user_id'});
  await ctx.answerCbQuery('حرکت لغو شد').catch(()=>{});
  await safeSend(uid, `✋ حرکت لغو شد. اعتبار مسیر ذخیره شد: ${humanize(elapsedSec)}\nحرکت بعدی به همین میزان کوتاه‌تر خواهد بود.`).catch(()=>{});
});

// --- join request (approve + announce + delayed kick)
bot.on('chat_join_request', async (ctx)=>{
  try{
    const req=ctx.update.chat_join_request; const userId=req.from.id; const chatId=`${req.chat.id}`;
    const st=await getChatState(chatId); if(st.locked){ await ctx.declineChatJoinRequest(userId); return; }

    const {data}=await supa.from('movements').select('move_id,arrive_at,state,to_page_id').eq('user_id',userId).eq('to_chat_id',chatId).eq('state','scheduled').order('departed_at',{ascending:false}).limit(1);
    const mv=data&&data[0]; if(!mv){ await ctx.declineChatJoinRequest(userId); return; }

    const timeOk = new Date(mv.arrive_at) <= new Date();
    if(!timeOk){
      await ctx.declineChatJoinRequest(userId);
      const wait = Math.max(1, Math.round((new Date(mv.arrive_at).getTime()-Date.now())/1000));
      await bot.telegram.sendMessage(userId, `⏳ هنوز زود است؛ ${humanize(wait)} دیگر تلاش کن.`).catch(()=>{});
      return;
    }

    // رفع بن احتمالی
    try{ await bot.telegram.unbanChatMember(chatId, userId); }catch{}
    await ctx.approveChatJoinRequest(userId);

    // ثبت رسیدن + اعلان + سپس حذف از سایر گروه‌ها
    await supa.from('movements').update({state:'arrived'}).eq('move_id', mv.move_id);
    await supa.from('players').upsert({ user_id:userId, current_chat_id:chatId, current_page_id: mv.to_page_id, status:'idle', updated_at: nowIso() },{onConflict:'user_id'});

    const page = await getPageById(mv.to_page_id);
    await announceEnter(chatId, page?.title||'اینجا', userId);
    kickOthers(`${chatId}`, userId).catch(()=>{});
  }catch(e){ console.log('join_request err:', e?.message||e); }
});

// --- fallback: new_chat_members (اگر Join Request خاموش باشد)
bot.on('new_chat_members', async (ctx)=>{
  try{
    const chatId=`${ctx.chat.id}`; const members=ctx.message?.new_chat_members||[]; if(!members.length) return;
    for(const m of members){
      const uid=m.id;
      const {data}=await supa.from('movements').select('move_id,to_page_id,arrive_at,state').eq('user_id',uid).eq('to_chat_id',chatId).eq('state','scheduled').order('departed_at',{ascending:false}).limit(1);
      const mv=data&&data[0]; if(!mv) continue;

      const timeOk = new Date(mv.arrive_at) <= new Date();
      if(!timeOk){
        const wait=Math.max(1,Math.round((new Date(mv.arrive_at).getTime()-Date.now())/1000));
        await bot.telegram.sendMessage(uid, `⏳ هنوز زود است؛ ${humanize(wait)} دیگر تلاش کن.`).catch(()=>{});
        continue;
      }

      await supa.from('movements').update({state:'arrived'}).eq('move_id',mv.move_id);
      await supa.from('players').upsert({ user_id:uid, current_chat_id:chatId, current_page_id:mv.to_page_id, status:'idle', updated_at: nowIso() },{onConflict:'user_id'});
      const page = await getPageById(mv.to_page_id);
      await announceEnter(chatId, page?.title||'اینجا', uid);
      kickOthers(`${chatId}`, uid).catch(()=>{});
    }
  }catch{}
});

// --- only owner can add bot
bot.on('my_chat_member', async (ctx)=>{
  try{
    const ns=ctx.update.my_chat_member?.new_chat_member?.status;
    const adder=ctx.update.my_chat_member?.from?.id;
    const chatId=ctx.chat?.id;
    if(ns && ['member','administrator'].includes(ns)){
      if(adder!==OWNER_ID){
        await bot.telegram.sendMessage(chatId,'این ربات متعلق به مجموعه اکلیس است ، شما حق استفاده از آنها رو ندارین ، حدتو بدون').catch(()=>{});
        await bot.telegram.leaveChat(chatId).catch(()=>{});
      }
    }
  }catch{}
});

// --- keepalive + webhook
const appUrl = RENDER_URL || '';
function startPing(){ if(!appUrl) return; setInterval(()=>axios.head(`${appUrl}/ping`).catch(()=>{}), 13*60*1000+59*1000); }
app.get('/ping',(_req,res)=>res.status(200).json({ok:true}));
app.use(bot.webhookCallback('/webhook'));
app.get('/',(_req,res)=>res.send('<h3>RPG World Bot</h3>'));
app.listen(PORT, async ()=>{
  console.log('🚀 Bot on',PORT); startPing();
  try{
    await bot.telegram.deleteWebhook({ drop_pending_updates:true });
    if(appUrl){ const url=`${appUrl}/webhook`; await bot.telegram.setWebhook(url); console.log('✅ Webhook:',url); }
    else { await bot.launch(); console.log('✅ Long polling'); }
  }catch(e){ console.log('Startup warn:', e.message); }
});
process.on('unhandledRejection', e=>console.log('Unhandled:', e?.message||e));
