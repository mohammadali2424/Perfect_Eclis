// index.js
// RPG World Bot — main/sub/micro + safe tokens + late kick + joinrequest fix + wizards + ETA + freeze/lock + VIP
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

// ---------- utils ----------
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const nowIso = ()=>new Date().toISOString();
const humanize=(s)=>{ s=Math.max(1,Math.round(s)); if(s<60) return `${s} ثانیه`; const m=Math.floor(s/60),r=s%60; return r?`${m} دقیقه و ${r} ثانیه`:`${m} دقیقه`; };
const normalize=(s='')=>s.replace(/\u200c/g,'').replace(/[ي]/g,'ی').replace(/[ك]/g,'ک').replace(/[ـ]+/g,'').replace(/\s+/g,' ').trim();
const isTrigger=(t,word)=>new RegExp(`^#\\s*${word}(?:\\s|$)`).test(normalize(t).toLowerCase());
const parseDur=(txt='')=>{
  const m=String(txt).trim().match(/^(\d+)\s*(s|sec|m|min|h|hr)?$/i);
  if(!m) return null; const n=parseInt(m[1],10); const u=(m[2]||'m').toLowerCase();
  if(u==='s'||u==='sec') return n; if(u==='h'||u==='hr') return n*3600; return n*60;
};
const mention = (uid)=>`[${uid}](tg://user?id=${uid})`;

// ---------- caches ----------
const cache = new NodeCache({ stdTTL: 180, checkperiod: 120, maxKeys: 20000 });
const inFlightUser = new NodeCache({ stdTTL: 8, checkperiod: 15 });

// short tokens for callback data
const cbMap = new NodeCache({ stdTTL: 600, checkperiod: 120, maxKeys: 50000 });
function randToken(n=10){ const a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'; let s=''; for(let i=0;i<n;i++) s+=a[Math.floor(Math.random()*a.length)]; return s; }
const putGateToken   =(p)=>{ const t=`g:${randToken(10)}`; cbMap.set(t,p); return t; };
const getGateToken   =(t)=>cbMap.get(t)||null;
const putCancelToken =(p)=>{ const t=`c:${randToken(10)}`; cbMap.set(t,p); return t; };
const getCancelToken =(t)=>cbMap.get(t)||null;
const putMicroToken  =(p)=>{ const t=`m:${randToken(10)}`; cbMap.set(t,p); return t; };
const getMicroToken  =(t)=>cbMap.get(t)||null;

// send queue (anti-429)
const q=[]; let pumping=false;
const enqueue=fn=>new Promise((res)=>{ q.push({fn,res}); if(!pumping) pump(); });
async function pump(){ pumping=true; while(q.length){ const {fn,res}=q.shift(); try{ res(await fn()); }catch(e){ res(Promise.reject(e)); } await sleep(80);} pumping=false; }
async function safeSend(chatId,text,extra={}) {
  try { return await enqueue(()=>bot.telegram.sendMessage(chatId,text,extra)); }
  catch (e) {
    const m=String(e.message||e);
    if(/429|timeout|ETELEGRAM/i.test(m)){ await sleep(600); try{ return await enqueue(()=>bot.telegram.sendMessage(chatId,text,extra)); }catch{} }
    throw e;
  }
}

// ---------- DB helpers ----------
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
  const {data,error}=await supa.from('pages').select('id,chat_id,title,body,order_index,active').eq('chat_id',`${chatId}`).order('order_index',{ascending:true}).order('title',{ascending:true}).limit(2000);
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
  const {data}=await supa.from('gates')
    .select('id,type,from_chat_id,from_page_id,to_chat_id,to_page_id,label,emoji,base_travel_sec,active,order_index,section')
    .eq('from_page_id',pageId)
    .order('order_index',{ascending:true}).order('id',{ascending:true}).limit(2000);
  const rows=(data||[]).filter(g=>g.active!==false);
  cache.set(k,rows,180); return rows;
}
async function upsertPlayer(p){ await supa.from('players').upsert(p,{ onConflict:'user_id' }); }
async function getPlayer(userId){ const {data}=await supa.from('players').select('user_id,current_chat_id,current_page_id,status,updated_at,pending_credit_sec').eq('user_id',userId).maybeSingle(); return data||null; }
async function getFirstPage(chatId){
  const pages=await getPages(chatId);
  return pages[0] || null;
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

// ---------- link pool ----------
const invitePool = new Map(); // to_chat_id -> {link, expireAtTs}
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

// ---------- UI builders ----------
function pageNeighbors(pages, pageId){
  const idx = pages.findIndex(p=>p.id===pageId);
  if(idx<0) return {prev:null,next:null,index:-1,total:pages.length};
  return { prev: pages[idx-1]?.id||null, next: pages[idx+1]?.id||null, index: idx, total: pages.length };
}
async function buildPageViewForUser(chatId, pageId){
  const page = await getPageById(pageId);
  if(!page) return null;

  // اگر ریزمسیر تعریف شده، رابط micro را بساز
  const microView = await buildMicroView(page, null);
  if(microView) return microView;

  const gates = await getGatesFromPage(pageId);
  const pages = await getPages(chatId);
  const neigh = pageNeighbors(pages, pageId);

  const rows=[];
  for(const g of gates.slice(0,24)){
    const label = `${g.emoji||'🧭'} ${g.label} — ${humanize(g.base_travel_sec)}`;
    const token = putGateToken({ gate_id: g.id, type: g.type, eta: g.base_travel_sec });
    rows.push([Markup.button.callback(label, `g:${token.slice(2)}`)]);
  }
  const nav = [];
  if(neigh.prev) nav.push(Markup.button.callback('◀️', `pnav:${chatId}:${neigh.prev}`));
  nav.push(Markup.button.callback(`${neigh.index+1}/${neigh.total}`, 'pnav:nop'));
  if(neigh.next) nav.push(Markup.button.callback('▶️', `pnav:${chatId}:${neigh.next}`));
  rows.push(nav);
  rows.push([Markup.button.callback('⏳ زمانِ باقی‌ماندهٔ من','pmenu:eta')]);

  const text = `📜 ${page.title}\n\nمسیر های شما :`;
  return { text, kb: Markup.inlineKeyboard(rows,{columns:1}), pageId: page.id };
}

// ----- micro (ریزمسیرها) -----
function getPageMetaSync(page){ return page?.meta_json||null; }
async function buildMicroView(pageOrId, currentNodeKey){
  const page = typeof pageOrId==='object' ? pageOrId : await getPageById(pageOrId);
  const meta = getPageMetaSync(page);
  const micro = meta?.micro; if(!micro) return null;

  const nodeKey = currentNodeKey || micro.start;
  const node = micro.nodes?.[nodeKey];
  if(!node) return null;

  const rows=[];
  for(const btn of (node.buttons||[]).slice(0,24)){
    const tok = putMicroToken({ page_id: page.id, next_key: btn.goto, eta: btn.eta||0, label: btn.label });
    rows.push([ Markup.button.callback(btn.label, `m:${tok.slice(2)}`) ]);
  }
  return { text:`📜 ${node.title}`, kb: Markup.inlineKeyboard(rows,{columns:1}), nodeKey };
}
bot.action(/^m:([A-Za-z0-9_-]{6,18})$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private') { try{ await ctx.answerCbQuery(); }catch{} return; }
  const tok = `m:${ctx.match[1]}`;
  const payload = getMicroToken(tok);
  if(!payload){ try{ await ctx.answerCbQuery('دکمه منقضی است. #ورود را بزن.'); }catch{} return; }

  const { page_id, next_key, eta, label } = payload;
  const v = await buildMicroView(page_id, next_key);
  if(!v){ try{ await ctx.answerCbQuery('مقصد نامعتبر'); }catch{} return; }

  const uid=ctx.from.id;
  const player = await getPlayer(uid);
  const chatId = player?.current_chat_id;
  const announce = async ()=>{
    if(chatId){
      try{ await safeSend(chatId, `🎯 پلیر ${mention(uid)} وارد ${v.text.replace(/^📜\s*/,'').trim()} شد.`, { parse_mode:'Markdown' }); }catch{}
    }
  };

  if(eta && eta>0){
    try{ await ctx.answerCbQuery(`⏳ ${humanize(eta)}`, true); }catch{}
    setTimeout(async ()=>{
      try{ await ctx.editMessageText(v.text, v.kb); }catch{ await safeSend(uid, v.text, v.kb); }
      await announce();
    }, eta*1000);
  }else{
    try{ await ctx.editMessageText(v.text, v.kb); }catch{ await safeSend(uid, v.text, v.kb); }
    await announce();
  }
});

// ---------- PV helpers ----------
async function sendCurrentPagePV(userId, chatId){
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

  const page = await getPageById(pageId);
  const microView = await buildMicroView(page, null);
  if(microView){ await safeSend(userId, microView.text, microView.kb); return true; }

  const view = await buildPageViewForUser(chatId, pageId);
  if(!view) return false;
  await safeSend(userId, view.text, view.kb);
  return true;
}

// ---------- movement / arrivals ----------
const timers=new Map();
const newMoveId=(u,k)=>`${u}_${k}_${Date.now()}`;

const arrQ=[]; let arrTimer=null;
function queueArrivalEvt(evt){ arrQ.push(evt); if(!arrTimer) arrTimer=setTimeout(flushArrivals,400); }
async function flushArrivals(){
  const batch = arrQ.splice(0, arrQ.length); arrTimer=null;
  if(batch.length===0) return;
  const ids = batch.map(b=>b.move_id);
  try{
    // gate_id را هم برگردانیم تا لیبل را اعلام کنیم
    const {data:updated, error} = await supa
      .from('movements')
      .update({ state:'arrived' })
      .in('move_id', ids)
      .eq('state','scheduled')
      .select('move_id,to_chat_id,to_page_id,user_id,gate_id');
    if(error) throw error;
    if(!updated || updated.length===0) return;

    // آپدیت وضعیت بازیکن
    const rows = updated.map(u=>({
      user_id: u.user_id,
      current_chat_id: `${u.to_chat_id}`,
      current_page_id: u.to_page_id,
      status: 'idle',
      updated_at: nowIso()
    }));
    await supa.from('players').upsert(rows, { onConflict:'user_id' });

    // گرفتن لیبل گیت‌ها برای اعلان «نام مسیر»
    const gids = [...new Set(updated.map(u=>u.gate_id).filter(Boolean))];
    let labelsMap = {};
    if(gids.length){
      const {data:grows}=await supa.from('gates').select('id,label').in('id',gids);
      for(const g of (grows||[])) labelsMap[g.id]=g.label;
    }

    // اعلان در گروه مقصد (فقط اگر عضو است)
    for(const u of updated){
      let isMember=false;
      try {
        const cm = await bot.telegram.getChatMember(u.to_chat_id, u.user_id);
        isMember = ['member','administrator','creator'].includes(cm.status);
      } catch {}
      if(!isMember) continue;

      // حالا که عضو مقصد شد، از بقیه گروه‌ها سافت‌کیک کن
      kickOthers(`${u.to_chat_id}`, u.user_id).catch(()=>{});

      // نام مسیر = لیبل گیت، اگر نبود، عنوان صفحه
      const page = await getPageById(u.to_page_id);
      const gLabel = u.gate_id ? (labelsMap[u.gate_id] || null) : null;
      const routeName = gLabel || (page?.title || 'اینجا');

      try{ await safeSend(u.to_chat_id, `🎯 پلیر ${mention(u.user_id)} وارد ${routeName} شد`, { parse_mode:'Markdown' }); }catch{}
    }
  }catch(e){
    console.log('Batch arrival error:', e.message||e);
  }
}
async function scheduleSubArrival(move){
  const delay=Math.max(0,new Date(move.arrive_at).getTime()-Date.now());
  if(delay>60*60*1000) return;
  if(timers.has(move.move_id)) return;
  const id=setTimeout(()=>{ timers.delete(move.move_id); queueArrivalEvt({ move_id: move.move_id }); }, delay);
  timers.set(move.move_id,id);
}
async function finalizeDueMoves(userId){
  try{
    const {data}=await supa
      .from('movements')
      .select('move_id,arrive_at,state')
      .eq('user_id', userId)
      .eq('state','scheduled')
      .lte('arrive_at', nowIso())
      .limit(50);
    const due = (data||[]).map(m=>({ move_id: m.move_id }));
    for(const d of due) queueArrivalEvt(d);
  }catch(e){ /* ignore */ }
}
async function hasActiveMove(userId){
  const {data}=await supa.from('movements').select('move_id,departed_at').eq('user_id',userId).eq('state','scheduled').order('departed_at',{ascending:false}).limit(1);
  return data && data[0];
}
async function canStartMove(chatId){
  const st = await getChatState(chatId);
  if(st.locked) return {ok:false, why: st.lmsg||'⛔️ منطقه قفل است'};
  if(st.freeze_until && Date.now() < st.freeze_until) return {ok:false, why: `❄️ این منطقه موقتاً فریز است`};
  return {ok:true};
}

// ---------- triggers ----------
async function handleVorud(ctx){
  const chatId=`${ctx.chat?.id}`; const userId=ctx.from?.id; if(!chatId||!userId) return;
  const allowed=await ensureAllowedChat(chatId); if(!allowed) return; // بی‌صدا
  await finalizeDueMoves(userId);
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

// ---------- commands ----------
const isOwner = (ctx)=>ctx.from?.id===OWNER_ID;
const replyNotOwner = async (ctx)=>{ try{ await ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده',{ reply_to_message_id: ctx.message?.message_id }); }catch{} };
const ensureOwner = (ctx)=>{ if(isOwner(ctx)) return true; replyNotOwner(ctx); return false; };

bot.start((ctx)=>ctx.reply('نینجا در خدمت شماست 🥷🏻'));

bot.command('on', async (ctx)=>{ if(!ensureOwner(ctx))return;
  const id=`${ctx.chat.id}`, title=ctx.chat.title||'بدون عنوان';
  const {error}=await supa.from('registered_chats').upsert({chat_id:id,title,created_at:nowIso()},{onConflict:'chat_id'});
  cache.del(`allowed:${id}`); cache.del(`rchat:${id}`); cache.del(`pages:${id}`);
  if(error){ console.log('on error',error); return ctx.reply('❌ خطا در ثبت منطقه'); }
  ctx.reply('✅ منطقه ثبت شد');
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
  const until=new Date(Date.now()+secs*1000).toISOString();
  await supa.from('registered_chats').update({ freeze_until: until }).eq('chat_id',`${ctx.chat.id}`);
  cache.del(`rchat:${ctx.chat.id}`);
  ctx.reply(`❄️ این منطقه تا ${humanize(secs)} فریز شد`);
});
bot.command('unfreeze', async (ctx)=>{ if(!ensureOwner(ctx))return;
  await supa.from('registered_chats').update({ freeze_until: null }).eq('chat_id',`${ctx.chat.id}`);
  cache.del(`rchat:${ctx.chat.id}`);
  ctx.reply('🔥 فریز برداشته شد');
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

// ---------- link_wizard ----------
const wizard=new Map();
const stOf=(uid)=>{ if(!wizard.has(uid)) wizard.set(uid,{step:0}); return wizard.get(uid); };
async function ensurePV(uid){ try{ await bot.telegram.sendChatAction(uid,'typing'); return true; }catch{ return false; } }
const wzReply = async (ctx, text, kb) => {
  try { await ctx.editMessageText(text, kb); } catch { try{ await safeSend(ctx.from.id, text, kb); }catch{} }
  try { await ctx.answerCbQuery(); } catch {}
};
async function listRegistered(page=1,size=8){
  const k='reg:list:all'; let list=cache.get(k);
  if(!list){ const {data,error}=await supa.from('registered_chats').select('chat_id,title').order('title',{ascending:true}).limit(5000);
    list=error?[]:(data||[]); cache.set(k,list,300);
  }
  const pagesCount=Math.max(1,Math.ceil(list.length/size));
  const items=list.slice((page-1)*size,(page-1)*size+size);
  return {items, page, pagesCount};
}
async function listPages(chatId,page=1,size=8){
  const list=await getPages(chatId);
  const pagesCount=Math.max(1,Math.ceil(list.length/size));
  const items=list.slice((page-1)*size,(page-1)*size+size);
  return {items, page, pagesCount};
}
async function listGates(pageId,page=1,size=8){
  const list=await getGatesFromPage(pageId);
  const pagesCount=Math.max(1,Math.ceil(list.length/size));
  const items=list.slice((page-1)*size,(page-1)*size+size);
  return {items, page, pagesCount};
}

bot.command('link_wizard', async (ctx)=>{
  if(!ensureOwner(ctx)) return;
  const invokedInGroup = ctx.chat?.type!=='private';
  const uid=ctx.from.id;
  const lastGroup = invokedInGroup ? `${ctx.chat.id}` : null;
  if(!(await ensurePV(uid))){ return; }
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
});

bot.action('wz:cancel', async (ctx)=>{ if(ctx.chat?.type!=='private'||!isOwner(ctx)) return; wizard.delete(ctx.from.id); await wzReply(ctx,'وِیزارد لغو شد.'); });
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
  await wzReply(ctx,'عنوان صفحهٔ مبدأ را بفرست', Markup.inlineKeyboard([[Markup.button.callback('❌ لغو','wz:cancel')]]));
});
bot.action('wz:nop', async (ctx)=>{ try{ await ctx.answerCbQuery(); }catch{} });

bot.on('text', async (ctx,next)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return next();
  const st=wizard.get(ctx.from.id); if(!st) return next();

  if(st.step==='fromPageTitle'){ st.fromPageTitle=(ctx.message.text||'').trim(); if(!st.fromPageTitle) return safeSend(ctx.from.id,'⛔️ عنوان خالی است'); st.step='fromPageBody'; return safeSend(ctx.from.id,'متن/توضیح صفحهٔ مبدأ را بفرست (اختیاری)'); }
  if(st.step==='fromPageBody'){
    st.fromPageBody=(ctx.message.text||'').trim();
    const pages=await getPages(st.fromChatId);
    const order=(pages[pages.length-1]?.order_index||0)+1;
    const ins={chat_id:st.fromChatId,title:st.fromPageTitle,body:st.fromPageBody,order_index:order,active:true};
    const {data:pg,error}=await supa.from('pages').insert(ins).select('id').single();
    if(error||!pg){ const hint=(error?.code==='42501')?' (RLS/Service Role)': ''; await safeSend(ctx.from.id,'❌ خطا در ذخیرهٔ صفحهٔ مبدأ: '+(error?.message||'نامشخص')+hint); st.step='fromPageTitle'; return; }
    cache.del(`pages:${st.fromChatId}`);
    st.fromPageId=pg.id; st.step='destChooser';
    if(st.type==='main'){ return safeSend(ctx.from.id,'گروه مقصد را انتخاب کن:', Markup.inlineKeyboard([[Markup.button.callback('📜 از گروه‌های ثبت‌شده','wz:to:list:1')],[Markup.button.callback('❌ لغو','wz:cancel')]])); }
    else { return safeSend(ctx.from.id,'صفحهٔ مقصد (در همین گروه) را انتخاب کن:', Markup.inlineKeyboard([[Markup.button.callback('📄 از صفحات موجود','wz:to:page:list:1')],[Markup.button.callback('➕ ساخت صفحهٔ جدید','wz:to:page:new')],[Markup.button.callback('❌ لغو','wz:cancel')]])); }
  }
  if(st.step==='toPageTitle'){ st.toPageTitle=(ctx.message.text||'').trim(); if(!st.toPageTitle) return safeSend(ctx.from.id,'⛔️ عنوان خالی است'); st.step='toPageBody'; return safeSend(ctx.from.id,'متن/توضیح صفحهٔ مقصد را بفرست (اختیاری)'); }
  if(st.step==='toPageBody'){
    st.toPageBody=(ctx.message.text||'').trim();
    const tgtChat = st.type==='main' ? st.toChatId : st.fromChatId;
    const pages=await getPages(tgtChat);
    const order=(pages[pages.length-1]?.order_index||0)+1;
    const ins={chat_id:tgtChat,title:st.toPageTitle,body:st.toPageBody,order_index:order,active:true};
    const {data:pg,error}=await supa.from('pages').insert(ins).select('id').single();
    if(error||!pg){ const hint=(error?.code==='42501')?' (RLS/Service Role)': ''; await safeSend(ctx.from.id,'❌ خطا در ذخیرهٔ صفحهٔ مقصد: '+(error?.message||'نامشخص')+hint); st.step='toPageTitle'; return; }
    cache.del(`pages:${tgtChat}`);
    st.toPageId=pg.id; st.step='gateProps';
    return safeSend(ctx.from.id,'لیبل دکمهٔ مسیر را بفرست (مثلاً «ورود به زیرزمین»).');
  }
  if(st.step==='gateProps'){
    st.gateLabel=(ctx.message.text||'').trim();
    if(!st.gateLabel) return safeSend(ctx.from.id,'⛔️ لیبل خالی است');
    st.step='gateTime';
    return safeSend(ctx.from.id,'⏱ زمان مسیر (ثانیه) را بفرست. (مثلاً 300)');
  }
  if(st.step==='gateTime'){
    const t=parseInt((ctx.message.text||'').trim(),10);
    if(!Number.isFinite(t)||t<=0) return safeSend(ctx.from.id,'⛔️ عدد معتبر بفرست (ثانیه).');
    st.gateTime=t; st.step='confirm';
    const desc=`بررسی نهایی:\nنوع: ${st.type}\nfrom: ${st.fromChatId} / page=${st.fromPageId}\n`+(st.type==='main'?`to: ${st.toChatId} / page=${st.toPageId}\n`:`to: ${st.fromChatId} / page=${st.toPageId}\n`)+`label: ${st.gateLabel}\ntime: ${t}s`;
    return safeSend(ctx.from.id,desc,Markup.inlineKeyboard([[Markup.button.callback('✅ ایجاد','wz:confirm')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }
  if(st.step==='rev:label'){
    st.revLabel=(ctx.message.text||'').trim();
    if(!st.revLabel) return safeSend(ctx.from.id,'⛔️ لیبل برگشت خالی است');
    st.step='rev:time';
    return safeSend(ctx.from.id,'⏱ زمان مسیر برگشت (ثانیه) را بفرست');
  }
  if(st.step==='rev:time'){
    const t=parseInt((ctx.message.text||'').trim(),10);
    if(!Number.isFinite(t)||t<=0) return safeSend(ctx.from.id,'⛔️ عدد معتبر بفرست (ثانیه).');
    st.revTime=t;
    const fromChat = st.type==='main' ? st.toChatId : st.fromChatId;
    const toChat   = st.type==='main' ? st.fromChatId : st.fromChatId;
    const gate = {
      type: st.type,
      from_chat_id: fromChat, from_page_id: st.toPageId,
      to_chat_id: toChat, to_page_id: st.fromPageId,
      label: st.revLabel, emoji:'🧭', base_travel_sec: t,
      active:true, order_index:0, section:null
    };
    await supa.from('gates').insert(gate);
    if(st.type==='main'){ cache.del(`gates:from:${st.toPageId}`); cache.del(`gates:from:${st.fromPageId}`); }
    else { cache.del(`gates:from:${st.fromPageId}`); }
    st.step=0;
    return safeSend(ctx.from.id,'✅ مسیر برگشت هم ساخته شد');
  }

  return next();
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
  const st=stOf(ctx.from.id); st.toChatId=ctx.match[1];
  await wzReply(ctx,'صفحهٔ مقصد را انتخاب کن:',Markup.inlineKeyboard([
    [Markup.button.callback('📄 از صفحات موجود','wz:to:page:list:1')],
    [Markup.button.callback('➕ ساخت صفحهٔ جدید','wz:to:page:new')],
    [Markup.button.callback('❌ لغو','wz:cancel')]
  ]));
});
bot.action(/^wz:to:page:list:(\d+)$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id); const p=parseInt(ctx.match[1],10)||1;
  const {items,page,pagesCount}=await listPages(st.type==='main'?st.toChatId:st.fromChatId,p,8);
  const rows=items.map(it=>[Markup.button.callback(`${it.title}`,`wz:to:page:set:${it.id}`)]);
  rows.push([Markup.button.callback('◀️',`wz:to:page:list:${Math.max(1,page-1)}`),Markup.button.callback(`${page}/${pagesCount}`,'wz:nop'),Markup.button.callback('▶️',`wz:to:page:list:${Math.min(pagesCount,page+1)}`)]);
  rows.push([Markup.button.callback('➕ ساخت صفحهٔ جدید','wz:to:page:new')],[Markup.button.callback('❌ لغو','wz:cancel')]);
  await wzReply(ctx,'صفحهٔ مقصد را انتخاب کن:',Markup.inlineKeyboard(rows,{columns:1}));
});
bot.action(/^wz:to:page:set:(.+)$/i, async (ctx)=>{ if(ctx.chat?.type!=='private'||!isOwner(ctx)) return; const st=stOf(ctx.from.id); st.toPageId=ctx.match[1]; st.step='gateProps'; await wzReply(ctx,'لیبل دکمهٔ مسیر را بفرست'); });
bot.action('wz:to:page:new', async (ctx)=>{ if(ctx.chat?.type!=='private'||!isOwner(ctx)) return; const st=stOf(ctx.from.id); st.step='toPageTitle'; await wzReply(ctx,'عنوان صفحهٔ مقصد را بفرست',Markup.inlineKeyboard([[Markup.button.callback('❌ لغو','wz:cancel')]])); });

bot.action('wz:confirm', async (ctx)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const uid=ctx.from.id; const st=stOf(uid);
  if(!st.fromChatId || !st.fromPageId || !st.gateLabel || !st.gateTime)
    return ctx.answerCbQuery('ناقص است').catch(()=>{});
  const type = st.type==='main' ? 'main' : 'sub';
  const toChat = st.type==='main' ? st.toChatId : st.fromChatId;
  if(st.type==='main' && (!st.toChatId || !st.toPageId))
    return ctx.answerCbQuery('مقصد ناقص').catch(()=>{});

  const gate = {
    type, from_chat_id: st.fromChatId, from_page_id: st.fromPageId,
    to_chat_id: toChat, to_page_id: st.toPageId,
    label: st.gateLabel, emoji:'🧭', base_travel_sec: parseInt(st.gateTime,10),
    active:true, order_index:0, section:null
  };
  try{
    const {error}=await supa.from('gates').insert(gate);
    if(error){ const hint=(error?.code==='42501')?' (RLS/Service Role)': ''; throw new Error((error.message||'DB error')+hint); }
    cache.del(`gates:from:${st.fromPageId}`);
    if(st.type==='main') cache.del(`gates:from:${st.toPageId}`);
    st.step='rev:ask';
    await wzReply(ctx,'مسیر برگشت هم ساخته بشه؟', Markup.inlineKeyboard([
      [Markup.button.callback('✅ بله','wz:rev:yes'), Markup.button.callback('❌ نه','wz:rev:no')]
    ]));
  }catch(e){
    await wzReply(ctx,'❌ خطا در ایجاد مسیر: '+(e.message||e));
  }
});
bot.action('wz:rev:yes', async (ctx)=>{ if(ctx.chat?.type!=='private'||!isOwner(ctx)) return; const st=stOf(ctx.from.id); st.step='rev:label'; await wzReply(ctx,'🏷️ لیبل مسیر برگشت را بفرست', Markup.inlineKeyboard([[Markup.button.callback('❌ لغو','wz:cancel')]])); });
bot.action('wz:rev:no', async (ctx)=>{ if(ctx.chat?.type!=='private'||!isOwner(ctx)) return; wizard.delete(ctx.from.id); await wzReply(ctx,'✅ مسیر ساخته شد'); });

// ---------- edit_wizard ----------
bot.command('edit_wizard', async (ctx)=>{
  if(!ensureOwner(ctx)) return;
  const uid=ctx.from.id;
  if(!(await ensurePV(uid))){ return; }
  const st=stOf(uid);
  st.step='edit:fromChat';
  st.edit = { };
  await safeSend(uid,'[ویرایش] گروه را انتخاب کن:', Markup.inlineKeyboard([
    [Markup.button.callback('📜 از گروه‌های ثبت‌شده','ed:from:list:1')],
    [Markup.button.callback('❌ لغو','wz:cancel')]
  ]));
});
bot.action(/^ed:from:list:(\d+)$/i, async (ctx)=>{ if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const p=parseInt(ctx.match[1],10)||1; const {items,page,pagesCount}=await listRegistered(p,8);
  const rows=items.map(it=>[Markup.button.callback(`${it.title||it.chat_id}`,`ed:from:set:${it.chat_id}`)]);
  rows.push([Markup.button.callback('◀️',`ed:from:list:${Math.max(1,page-1)}`),Markup.button.callback(`${page}/${pagesCount}`,'wz:nop'),Markup.button.callback('▶️',`ed:from:list:${Math.min(pagesCount,page+1)}`)]);
  rows.push([Markup.button.callback('❌ لغو','wz:cancel')]);
  await wzReply(ctx,'[ویرایش] گروه را انتخاب کن:',Markup.inlineKeyboard(rows,{columns:1}));
});
bot.action(/^ed:from:set:(-?\d{6,20})$/i, async (ctx)=>{ if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id); st.edit.fromChatId=ctx.match[1];
  await wzReply(ctx,'[ویرایش] صفحه را انتخاب کن:', Markup.inlineKeyboard([
    [Markup.button.callback('📄 از صفحات موجود','ed:page:list:1')],
    [Markup.button.callback('❌ لغو','wz:cancel')]
  ]));
});
bot.action(/^ed:page:list:(\d+)$/i, async (ctx)=>{ if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id); const p=parseInt(ctx.match[1],10)||1;
  const {items,page,pagesCount}=await listPages(st.edit.fromChatId,p,8);
  const rows=items.map(it=>[Markup.button.callback(`${it.title}`,`ed:page:set:${it.id}`)]);
  rows.push([Markup.button.callback('◀️',`ed:page:list:${Math.max(1,page-1)}`),Markup.button.callback(`${page}/${pagesCount}`,'wz:nop'),Markup.button.callback('▶️',`ed:page:list:${Math.min(pagesCount,page+1)}`)]);
  rows.push([Markup.button.callback('❌ لغو','wz:cancel')]);
  await wzReply(ctx,'[ویرایش] صفحه را انتخاب کن:',Markup.inlineKeyboard(rows,{columns:1}));
});
bot.action(/^ed:page:set:(.+)$/i, async (ctx)=>{ if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id); st.edit.fromPageId=ctx.match[1];
  await wzReply(ctx,'[ویرایش] مسیر را انتخاب کن:', Markup.inlineKeyboard([
    [Markup.button.callback('🧭 مسیرها','ed:gate:list:1')],
    [Markup.button.callback('❌ لغو','wz:cancel')]
  ]));
});
bot.action(/^ed:gate:list:(\d+)$/i, async (ctx)=>{ if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id); const p=parseInt(ctx.match[1],10)||1;
  const {items,page,pagesCount}=await listGates(st.edit.fromPageId,p,8);
  const rows=items.map(it=>[Markup.button.callback(`${it.label} (${it.type}/${humanize(it.base_travel_sec)})`,`ed:gate:set:${it.id}`)]);
  rows.push([Markup.button.callback('◀️',`ed:gate:list:${Math.max(1,page-1)}`),Markup.button.callback(`${page}/${pagesCount}`,'wz:nop'),Markup.button.callback('▶️',`ed:gate:list:${Math.min(pagesCount,page+1)}`)]);
  rows.push([Markup.button.callback('❌ لغو','wz:cancel')]);
  await wzReply(ctx,'[ویرایش] مسیر را انتخاب کن:',Markup.inlineKeyboard(rows,{columns:1}));
});
bot.action(/^ed:gate:set:(.+)$/i, async (ctx)=>{ if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id); st.edit.gateId=ctx.match[1];
  await wzReply(ctx,'چه چیزی را می‌خواهی تغییر بدهی؟', Markup.inlineKeyboard([
    [Markup.button.callback('🏷️ لیبل','ed:field:label')],
    [Markup.button.callback('⏱ زمان','ed:field:time')],
    [Markup.button.callback('✅/⛔️ فعال/غیرفعال','ed:field:toggle')],
    [Markup.button.callback('❌ لغو','wz:cancel')]
  ]));
});
bot.action(/^ed:field:(label|time|toggle)$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return;
  const st=stOf(ctx.from.id); const f=ctx.match[1];
  st.edit.field=f;
  if(f==='toggle'){
    const {data}=await supa.from('gates').select('active').eq('id',st.edit.gateId).maybeSingle();
    const next = !(data?.active!==false);
    await supa.from('gates').update({active: next}).eq('id',st.edit.gateId);
    return wzReply(ctx,`وضعیت مسیر: ${next?'✅ فعال':'⛔️ غیرفعال'}`);
  }
  if(f==='label'){ st.step='edit:set:label'; return wzReply(ctx,'لیبل جدید را بفرست',Markup.inlineKeyboard([[Markup.button.callback('❌ لغو','wz:cancel')]])); }
  if(f==='time'){ st.step='edit:set:time'; return wzReply(ctx,'زمان جدید (ثانیه) را بفرست',Markup.inlineKeyboard([[Markup.button.callback('❌ لغو','wz:cancel')]])); }
});
bot.on('text', async (ctx,next)=>{
  if(ctx.chat?.type!=='private'||!isOwner(ctx)) return next();
  const st=wizard.get(ctx.from.id); if(!st) return next();

  if(st.step==='edit:set:label'){
    const label=(ctx.message.text||'').trim(); if(!label) return safeSend(ctx.from.id,'لیبل نامعتبر');
    await supa.from('gates').update({label}).eq('id',st.edit.gateId);
    st.step=0; return safeSend(ctx.from.id,'✅ لیبل ویرایش شد');
  }
  if(st.step==='edit:set:time'){
    const t=parseInt((ctx.message.text||'').trim(),10); if(!Number.isFinite(t)||t<=0) return safeSend(ctx.from.id,'⏱ عدد معتبر بفرست');
    await supa.from('gates').update({base_travel_sec:t}).eq('id',st.edit.gateId);
    st.step=0; return safeSend(ctx.from.id,'✅ زمان ویرایش شد');
  }
  return next();
});

// ---------- PV nav & ETA ----------
bot.action(/^pnav:(-?\d{6,20}):(.+)$/i, async (ctx)=>{
  if(ctx.chat?.type!=='private') { try{ await ctx.answerCbQuery(); }catch{} return; }
  const chatId=ctx.match[1]; const pageId=ctx.match[2];
  const view = await buildPageViewForUser(chatId,pageId);
  if(!view){ try{ await ctx.answerCbQuery('صفحه نامعتبر'); }catch{} return; }
  try{ await ctx.editMessageText(view.text, view.kb); }catch{ await safeSend(ctx.from.id, view.text, view.kb); }
  try{ await ctx.answerCbQuery(); }catch{}
});
bot.action('pnav:nop', async (ctx)=>{ try{ await ctx.answerCbQuery(); }catch{} });

bot.action('pmenu:eta', async (ctx)=>{
  const uid=ctx.from.id;
  const {data:mv}=await supa.from('movements').select('move_id,arrive_at,departed_at,state').eq('user_id',uid).eq('state','scheduled').order('departed_at',{ascending:false}).limit(1);
  const m=mv&&mv[0]; if(!m) return ctx.answerCbQuery('حرکتی در جریان نیست').catch(()=>{});
  const d=new Date(m.arrive_at).getTime()-Date.now();
  if(d<=0){
    await finalizeDueMoves(uid);
    return ctx.answerCbQuery('به مقصد رسیدی (یا هر لحظه می‌رسی)').catch(()=>{});
  }
  return ctx.answerCbQuery(`زمان باقی‌مانده: ${humanize(Math.round(d/1000))}`).catch(()=>{});
});

// ---------- gate clicks (main/sub) ----------
bot.action(/^g:([A-Za-z0-9_-]{6,18})$/i, async (ctx)=>{
  const tok = `g:${ctx.match[1]}`;
  const payload = getGateToken(tok);
  if(!payload){ try{ await ctx.answerCbQuery('دکمه منقضی است. #ورود را بزن.'); }catch{} return; }

  const { gate_id, type:gtype, eta:baseEta } = payload;
  const uid=ctx.from.id;

  if(inFlightUser.get(uid)) { try{ await ctx.answerCbQuery('در حال پردازش…'); }catch{} return; }
  inFlightUser.set(uid,1,5);

  const {data:g}=await supa.from('gates').select('id,type,from_chat_id,from_page_id,to_chat_id,to_page_id,label,base_travel_sec').eq('id',gate_id).maybeSingle();
  if(!g){ try{ await ctx.answerCbQuery('مسیر نامعتبر'); }catch{} return; }

  const check = await canStartMove(`${g.from_chat_id}`);
  if(!check.ok){ try{ await ctx.answerCbQuery(check.why); }catch{} return; }

  const active = await hasActiveMove(uid);
  if(active){
    try { await ctx.answerCbQuery('⏳ در حال حرکت هستی. ابتدا «لغو حرکت» را بزن.'); } catch {}
    return;
  }

  const player = await getPlayer(uid);
  const credit = Math.max(0, parseInt(player?.pending_credit_sec||0,10) || 0);
  const etaSec = Math.max(10, (parseInt(baseEta,10)||g.base_travel_sec) - credit);

  const depart = nowIso();
  const arrive = new Date(Date.now()+etaSec*1000).toISOString();
  const moveId = `${uid}_${gate_id}_${Date.now()}`;

  if(credit>0){ await supa.from('players').update({ pending_credit_sec: 0 }).eq('user_id', uid); }

  if(gtype==='sub'){
    await supa.from('players').upsert({ user_id:uid, current_chat_id:`${g.to_chat_id}`, current_page_id:g.from_page_id, status:'quarantined', updated_at:depart },{onConflict:'user_id'});
    await supa.from('movements').insert({
      move_id:moveId, user_id:uid, from_chat_id:`${g.from_chat_id}`, to_chat_id:`${g.to_chat_id}`,
      from_page_id:g.from_page_id, to_page_id:g.to_page_id,
      gate_id:gate_id, departed_at:depart, arrive_at:arrive, state:'scheduled',
      invite_link:null, ticket_expires_at:null
    });
    scheduleSubArrival({ move_id: moveId, arrive_at: arrive });

    const cancelTok = putCancelToken({ move_id: moveId, from_chat_id: `${g.from_chat_id}` });
    try{
      await ctx.answerCbQuery('حرکتت ثبت شد');
      await safeSend(uid,
        `شما درحال حرکت هستی…\n\nمسیر شما به سمت «${(await getPageById(g.to_page_id))?.title||'مقصد'}» است.\nمدت مسیر: ${humanize(etaSec)}`,
        Markup.inlineKeyboard([[Markup.button.callback('❌ لغو حرکت', `c:${cancelTok.slice(2)}`)]])
      );
    }catch{}
    return;
  }

  // main — IMPORTANT: no kick here (late kick after approval)
  let pooledLink;
  try { pooledLink = await getPooledJoinRequestLink(g.to_chat_id); }
  catch (e) {
    console.log('[invitePool] failed:', e?.description || e?.message || e);
    try { await ctx.answerCbQuery('🚫 ایجاد لینک ممکن نشد (ادمین/Join Request؟)'); } catch {}
    return;
  }

  await supa.from('players').upsert({
    user_id:uid, current_chat_id:`${g.to_chat_id}`, current_page_id:g.from_page_id, status:'quarantined', updated_at:depart
  },{onConflict:'user_id'});

  await supa.from('movements').insert({
    move_id:moveId, user_id:uid, from_chat_id:`${g.from_chat_id}`, to_chat_id:`${g.to_chat_id}`,
    from_page_id:g.from_page_id, to_page_id:g.to_page_id,
    gate_id:gate_id, departed_at:depart, arrive_at:arrive, state:'scheduled',
    invite_link:null, ticket_expires_at:new Date(Date.now()+5*60*1000).toISOString()
  });

  const destPage = await getPageById(g.to_page_id);
  const cancelTok = putCancelToken({ move_id: moveId, from_chat_id: `${g.from_chat_id}` });
  await bot.telegram.sendMessage(
    uid,
    `شما درحال حرکت هستی…\n\nمسیر شما به سمت «${destPage?.title||'مقصد'}» است.\nمدت مسیر: ${humanize(etaSec)}\n\nوقتی به زمان مقرر رسیدی، روی دکمه بزن:`,
    Markup.inlineKeyboard([
      [ Markup.button.url('ورود به مقصد', pooledLink.invite_link) ],
      [ Markup.button.callback('❌ لغو حرکت', `c:${cancelTok.slice(2)}`) ]
    ])
  );
  try { await ctx.answerCbQuery('بلیت در PV ارسال شد'); } catch {}
});

// ---------- cancel ----------
bot.action(/^c:([A-Za-z0-9_-]{6,18})$/i, async (ctx)=>{
  const tok = `c:${ctx.match[1]}`;
  const payload = getCancelToken(tok);
  if(!payload){ try{ await ctx.answerCbQuery('منقضی شده'); }catch{} return; }
  const { move_id, from_chat_id } = payload;
  const uid = ctx.from.id;

  const { data, error } = await supa.from('movements')
    .select('move_id,user_id,departed_at,state')
    .eq('move_id', move_id).eq('user_id', uid).eq('state','scheduled').maybeSingle();
  if(error || !data){ try{ await ctx.answerCbQuery('حرکتی برای لغو نیست'); }catch{} return; }

  const departedAt = new Date(data.departed_at).getTime();
  const elapsedSec = Math.max(0, Math.round((Date.now() - departedAt)/1000));

  await supa.from('movements').update({ state:'cancelled' }).eq('move_id', move_id);
  await supa.from('players').upsert({ user_id: uid, pending_credit_sec: elapsedSec, updated_at: nowIso(), current_chat_id: `${from_chat_id}` }, { onConflict:'user_id' });

  try { await ctx.answerCbQuery('حرکت لغو شد'); } catch {}
  try { await safeSend(uid, `✋ حرکت لغو شد. اعتبار مسیر ذخیره شد: ${humanize(elapsedSec)}\nحرکت بعدی به همین میزان کوتاه‌تر خواهد بود.`); } catch {}
});

// ---------- join request ----------
bot.on('chat_join_request', async (ctx)=>{
  try{
    const req=ctx.update.chat_join_request; const userId=req.from.id; const chatId=`${req.chat.id}`;
    const st=await getChatState(chatId);
    if(st.locked){ await ctx.declineChatJoinRequest(userId); return; }

    const {data}=await supa.from('movements')
      .select('move_id,arrive_at,state,to_page_id,gate_id')
      .eq('user_id',userId).eq('to_chat_id',chatId).eq('state','scheduled')
      .order('departed_at',{ascending:false}).limit(1);
    const mv=data&&data[0]; if(!mv){ await ctx.declineChatJoinRequest(userId); return; }

    const now = new Date();
    if (new Date(mv.arrive_at) <= now) {
      try { await bot.telegram.unbanChatMember(chatId, userId); } catch {}
      await ctx.approveChatJoinRequest(userId);

      // حالا عضو شد: از گروه‌های دیگر حذف کن (دیرهنگام)
      kickOthers(`${chatId}`, userId).catch(()=>{});

      // بلافاصله رسیدن را نهایی کن تا پیام «پلیر وارد شد» برود
      queueArrivalEvt({ move_id: mv.move_id });
    } else {
      await ctx.declineChatJoinRequest(userId);
      const wait = Math.max(1, Math.round((new Date(mv.arrive_at).getTime()-now.getTime())/1000));
      try{ await bot.telegram.sendMessage(userId, `⏳ هنوز زود است؛ ${humanize(wait)} دیگر دوباره روی «ورود به مقصد» بزن.`); }catch{}
    }
  }catch(e){
    console.log('join_request err:', e?.message || e);
  }
});

// ---------- fallback: new_chat_members ----------
bot.on('new_chat_members', async (ctx) => {
  try {
    const chatId = `${ctx.chat.id}`;
    const members = ctx.message?.new_chat_members || [];
    if (!members.length) return;

    for (const m of members) {
      const uid = m.id;
      const { data } = await supa.from('movements')
        .select('move_id,to_page_id,arrive_at,state,gate_id')
        .eq('user_id', uid).eq('to_chat_id', chatId).eq('state', 'scheduled')
        .order('departed_at', { ascending:false }).limit(1);
      const mv = data && data[0];
      if (!mv) continue;

      if (new Date(mv.arrive_at) <= new Date()) {
        await supa.from('movements').update({ state: 'arrived' }).eq('move_id', mv.move_id);
        await supa.from('players').upsert({
          user_id: uid, current_chat_id: chatId, current_page_id: mv.to_page_id, status: 'idle', updated_at: nowIso()
        }, { onConflict:'user_id' });

        // حالا عضو مقصد است: دیرهنگام، از بقیه گروه‌ها حذف کن
        kickOthers(`${chatId}`, uid).catch(()=>{});

        // نام مسیر
        const page = await getPageById(mv.to_page_id);
        let gLabel=null; try{ const {data:rows}=await supa.from('gates').select('label').eq('id',mv.gate_id).maybeSingle(); gLabel=rows?.label||null; }catch{}
        const routeName = gLabel || (page?.title || 'اینجا');

        try { await safeSend(chatId, `🎯 پلیر ${mention(uid)} وارد ${routeName} شد`, { parse_mode:'Markdown' }); } catch {}
      } else {
        const wait = Math.max(1, Math.round((new Date(mv.arrive_at).getTime() - Date.now())/1000));
        try { await bot.telegram.sendMessage(uid, `⏳ هنوز زود است؛ ${humanize(wait)} دیگر تلاش کن.`); } catch {}
      }
    }
  } catch (e) {}
});

// ---------- only owner can add bot ----------
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

// ---------- micro admin ----------
bot.command('micro_set', async (ctx)=>{
  if(ctx.chat?.type!=='private' || ctx.from.id!==OWNER_ID) return;
  const reply = ctx.message?.reply_to_message?.text;
  if(!reply) return ctx.reply('JSON را ریپلای این دستور کن\nفرمت: /micro_set <page_id>');
  let obj; try{ obj=JSON.parse(reply); }catch{ return ctx.reply('JSON نامعتبر'); }
  if(!obj.micro || !obj.micro.nodes || !obj.micro.start) return ctx.reply('ساختار micro ناقص است');
  const pageId = (ctx.message?.text||'').split(/\s+/)[1];
  if(!pageId) return ctx.reply('فرمت: /micro_set <page_id> (و JSON را ریپلای کن)');
  const { error } = await supa.from('pages').update({ meta_json: obj }).eq('id', pageId);
  cache.del(`page:${pageId}`); cache.del(`page:${pageId}:meta`);
  if(error) return ctx.reply('خطای ذخیره: '+(error.message||''));
  return ctx.reply('✅ micro ذخیره شد.');
});
bot.command('micro_clear', async (ctx)=>{
  if(ctx.chat?.type!=='private' || ctx.from.id!==OWNER_ID) return;
  const pageId = (ctx.message?.text||'').split(/\s+/)[1];
  if(!pageId) return ctx.reply('فرمت: /micro_clear <page_id>');
  const { error } = await supa.from('pages').update({ meta_json: null }).eq('id', pageId);
  cache.del(`page:${pageId}`); cache.del(`page:${pageId}:meta`);
  if(error) return ctx.reply('خطای حذف: '+(error.message||''));
  return ctx.reply('✅ micro پاک شد.');
});

// ---------- keepalive & webhook ----------
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
