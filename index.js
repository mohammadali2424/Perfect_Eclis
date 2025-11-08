// --- RPG World Bot (silent #ورود + fixed link wizard PV) ---
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
  console.error('❌ ENV ناقص است'); process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 9000 });
const supa = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const app = express(); app.use(express.json());

const cache = new NodeCache({ stdTTL: 600, checkperiod: 120, maxKeys: 10000 });
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const nowIso = ()=>new Date().toISOString();
const withTimeout = (p,ms)=>Promise.race([p,new Promise((_,r)=>setTimeout(()=>r(new Error('LOCAL_TIMEOUT')),ms))]);

let ME_ID=null; (async()=>{ try{ ME_ID=(await bot.telegram.getMe()).id; }catch{} })();

const isOwner = (ctx)=>ctx.from?.id===OWNER_ID;
const replyNotOwner = async (ctx)=>{ try{ await ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده',{reply_to_message_id:ctx.message?.message_id}); }catch{} };
const ensureOwner = (ctx)=>{ if(isOwner(ctx)) return true; replyNotOwner(ctx); return false; };

const normalize=(s='')=>s.replace(/\u200c/g,'').replace(/[ي]/g,'ی').replace(/[ك]/g,'ک').replace(/[ـ]+/g,'').replace(/\s+/g,' ').trim();
const isTrigger=(t,word)=>new RegExp(`^#\\s*${word}(?:\\s|$)`).test(normalize(t).toLowerCase());

// rate-limited sender
const q=[]; let pumping=false;
const enqueue=fn=>new Promise(res=>{ q.push({fn,res}); if(!pumping) pump(); });
async function pump(){ pumping=true; while(q.length){ const {fn,res}=q.shift(); try{ res(await fn()); }catch(e){ res(Promise.reject(e)); } await sleep(70);} pumping=false; }
async function safeSendMessage(chatId,text,extra={}){ try{ return await enqueue(()=>bot.telegram.sendMessage(chatId,text,extra)); }catch(e){ const m=String(e.message||e); if(/429|timeout|ETELEGRAM/i.test(m)){ await sleep(600); try{ return await enqueue(()=>bot.telegram.sendMessage(chatId,text,extra)); }catch{} } throw e; }}

// DB helpers
async function ensureAllowedChat(chatId){
  const k=`allowed:${chatId}`; const c=cache.get(k); if(c!==undefined) return c;
  try{ const {data,error}=await withTimeout(supa.from('registered_chats').select('chat_id').eq('chat_id',`${chatId}`).maybeSingle(),5000);
    const ok=!error&&!!data; cache.set(k,ok,600); return ok; }catch{ cache.set(k,false,120); return false; }
}
async function getChatTitle(chatId){ const k=`title:${chatId}`; const c=cache.get(k); if(c!==undefined) return c;
  const {data}=await supa.from('registered_chats').select('title').eq('chat_id',`${chatId}`).maybeSingle();
  const t=data?.title||`${chatId}`; cache.set(k,t,3600); return t; }
async function getRegionState(chatId){ const k=`region:${chatId}`; const c=cache.get(k); if(c) return c;
  const {data}=await supa.from('registered_chats').select('locked,locked_message').eq('chat_id',`${chatId}`).maybeSingle();
  const st={locked:!!data?.locked,msg:data?.locked_message||'این منطقه فعلاً بسته است.'}; cache.set(k,st,300); return st; }
async function getGatesFrom(fromId){
  const k=`gates:${fromId}`; const c=cache.get(k); if(c) return c;
  const {data}=await withTimeout(
    supa.from('gates').select('id,from_chat_id,to_chat_id,label,emoji,base_travel_sec,active,section,order_index')
      .eq('from_chat_id',`${fromId}`).order('section',{ascending:true}).order('order_index',{ascending:true}).order('id',{ascending:true}).limit(500),
    6000
  );
  const rows=(data||[]).filter(g=>g.active!==false); cache.set(k,rows,600); return rows;
}
async function fetchLockMap(ids){ if(!ids.length) return {}; const {data}=await supa.from('registered_chats').select('chat_id,locked').in('chat_id',ids.map(String));
  const m={}; for(const r of (data||[])) m[`${r.chat_id}`]=!!r.locked; return m; }
async function upsertPlayer(p){ await supa.from('players').upsert(p,{onConflict:'user_id'}); }
async function upsertMovement(m){ await supa.from('movements').upsert(m,{onConflict:'move_id'}); }
const newMoveId=(u,g)=>`${u}_${g}_${Date.now()}`;
const humanize=(s)=>{ s=Math.max(1,Math.round(s)); if(s<60) return `${s} ثانیه`; const m=Math.floor(s/60),r=s%60; return r?`${m} دقیقه و ${r} ثانیه`:`${m} دقیقه`; };

// PV menus
async function listSections(fromId){
  const gs=await getGatesFrom(fromId); const map=new Map();
  for(const g of gs){ const s=(g.section||'اصلی').slice(0,40); map.set(s,(map.get(s)||0)+1); }
  return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0],'fa'));
}
async function buildSectionMenuPV(fromId){
  const secs=await listSections(fromId);
  const rows=secs.map(([n,c])=>[Markup.button.callback(`📂 ${n} (${c})`,`pmenu:sec:${fromId}:${encodeURIComponent(n)}`)]);
  rows.push([Markup.button.callback('⏳ زمانِ باقی‌ماندهٔ من','pmenu:eta')]);
  return { text:`مبدأ: ${await getChatTitle(fromId)}\nبخش مورد نظر را انتخاب کن:`,
           kb: Markup.inlineKeyboard(rows.length?rows:[[Markup.button.callback('بخشی ثبت نشده','wz:nop')]],{columns:1}) };
}
async function buildGatesMenuPV(fromId,section){
  const gs=(await getGatesFrom(fromId)).filter(g=>(g.section||'اصلی')===section);
  const toIds=gs.map(g=>`${g.to_chat_id}`); const lockMap=await fetchLockMap([...new Set(toIds)]);
  const rows=[];
  for(const g of gs.slice(0,24)){
    const locked=!!lockMap[`${g.to_chat_id}`];
    const text=`${locked?'⛔️ ':''}${g.emoji||'🧭'} ${g.label} — ${humanize(g.base_travel_sec)}`;
    rows.push([Markup.button.callback(text,`ticket:gate:${g.id}:${g.base_travel_sec}:pm`)]);
  }
  rows.push([Markup.button.callback('⬅️ صفحات',`pmenu:sections:${fromId}`)]);
  rows.push([Markup.button.callback('⏳ زمانِ باقی‌ماندهٔ من','pmenu:eta')]);
  return { text:`مبدأ: ${await getChatTitle(fromId)}\nبخش «${section}» — مسیرها:`,
           kb: Markup.inlineKeyboard(rows,{columns:1}) };
}
async function sendMenuToPV(fromId,userId){
  try{ await bot.telegram.sendChatAction(userId,'typing'); }catch{ return false; }
  const secs=await listSections(fromId);
  if(secs.length>1){ const {text,kb}=await buildSectionMenuPV(fromId); await safeSendMessage(userId,text,kb); }
  else{ const sec=secs[0]?.[0]||'اصلی'; const {text,kb}=await buildGatesMenuPV(fromId,sec); await safeSendMessage(userId,text,kb); }
  return true;
}

// quarantine helpers
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
    await sleep(80); return true;
  }catch{ return false; }
}
async function kickOthers(keepChatId,userId){
  const k='registered:list'; let regs=cache.get(k);
  if(!regs){ const {data}=await supa.from('registered_chats').select('chat_id').limit(5000); regs=data||[]; cache.set(k,regs,600); }
  for(const r of regs){ const cid=`${r.chat_id}`; if(cid===`${keepChatId}`) continue; await softKick(cid,userId); }
}

// scheduler
const timers=new Map();
async function scheduleArrival(move){
  const delay=Math.max(0,new Date(move.arrive_at).getTime()-Date.now());
  if(delay>3600*1000) return;
  if(timers.has(move.move_id)) return;
  const id=setTimeout(async()=>{
    timers.delete(move.move_id);
    try{
      const {data:m}=await supa.from('movements').select('state,to_chat_id,user_id').eq('move_id',move.move_id).maybeSingle();
      if(!m||m.state!=='scheduled') return;
      // پیام ورود در مقصد (گروه) — مثل قبل
      const gates=await getGatesFrom(m.to_chat_id);
      if(!gates?.length){ await safeSendMessage(m.to_chat_id,'🔍 برای این منطقه هنوز مسیری تعریف نشده. از /link_wizard در PV استفاده کن.'); }
      else{
        const secs=await listSections(m.to_chat_id);
        if(secs.length>1){
          const rows=secs.map(([n,c])=>[Markup.button.callback(`📂 ${n} (${c})`,`menu:sec:${encodeURIComponent(n)}`)]);
          await safeSendMessage(m.to_chat_id,'🎴┊وارد شدی؛ مسیرت را انتخاب کن:',Markup.inlineKeyboard(rows,{columns:1}));
        }else{
          const sec=secs[0]?.[0]||'اصلی';
          const gs=(await getGatesFrom(m.to_chat_id)).filter(g=>(g.section||'اصلی')===sec);
          const toIds=gs.map(g=>`${g.to_chat_id}`); const lm=await fetchLockMap([...new Set(toIds)]);
          const rows=[];
          for(const g of gs.slice(0,24)){ const locked=!!lm[`${g.to_chat_id}`]; const text=`${locked?'⛔️ ':''}${g.emoji||'🧭'} ${g.label} — ${humanize(g.base_travel_sec)}`;
            rows.push([Markup.button.callback(text,`ticket:gate:${g.id}:${g.base_travel_sec}`)]); }
          await safeSendMessage(m.to_chat_id,'🎴┊وارد شدی؛ هوای اینجا بوی ماجرا می‌دهد...',Markup.inlineKeyboard(rows,{columns:1}));
        }
      }
      await supa.from('players').update({status:'idle',updated_at:nowIso()}).eq('user_id',m.user_id);
      await supa.from('movements').update({state:'arrived'}).eq('move_id',move.move_id);
    }catch{}
  },delay);
  timers.set(move.move_id,id);
}
async function bootCatchUp(){
  const from=new Date(Date.now()-120_000).toISOString();
  const to=new Date(Date.now()+120_000).toISOString();
  const {data}=await supa.from('movements').select('move_id,user_id,to_chat_id,arrive_at,state').eq('state','scheduled').gte('arrive_at',from).lte('arrive_at',to).limit(500);
  for(const m of (data||[])) scheduleArrival(m);
}

// callback_query
bot.on('callback_query', async (ctx)=>{
  try{
    const data=ctx.callbackQuery?.data||''; const chatType=ctx.chat?.type; const userId=ctx.from?.id; const chatId=ctx.chat?.id;

    if(data==='wz:nop'){ await ctx.answerCbQuery(); return; }

    // ===== PV menus =====
    if(data.startsWith('pmenu:sections:')){
      const fromId=data.split(':')[2];
      const {text,kb}=await buildSectionMenuPV(fromId);
      try{ await ctx.editMessageText(text,kb); }catch{ await safeSendMessage(userId,text,kb); }
      return void ctx.answerCbQuery();
    }
    if(data.startsWith('pmenu:sec:')){
      const parts=data.split(':'); const fromId=parts[2]; const sec=decodeURIComponent(parts.slice(3).join(':'));
      const {text,kb}=await buildGatesMenuPV(fromId,sec);
      try{ await ctx.editMessageText(text,kb); }catch{ await safeSendMessage(userId,text,kb); }
      return void ctx.answerCbQuery();
    }
    if(data==='pmenu:eta'){
      const {data:mv}=await supa.from('movements').select('arrive_at,state').eq('user_id',userId).eq('state','scheduled').order('departed_at',{ascending:false}).limit(1);
      const m=mv&&mv[0]; if(!m) return void ctx.answerCbQuery('حرکتی در جریان نیست');
      const d=new Date(m.arrive_at).getTime()-Date.now(); if(d<=0) return void ctx.answerCbQuery('به مقصد رسیدی (یا هر لحظه می‌رسی)');
      return void ctx.answerCbQuery(`زمان باقی‌مانده: ${humanize(Math.round(d/1000))}`);
    }

    // ===== group section menu (arrival) =====
    if(data==='menu:sections'){
      const secs=await listSections(`${chatId}`);
      const rows=secs.map(([n,c])=>[Markup.button.callback(`📂 ${n} (${c})`,`menu:sec:${encodeURIComponent(n)}`)]);
      try{ await ctx.editMessageText('بخش را انتخاب کن:',Markup.inlineKeyboard(rows,{columns:1})); }catch{}
      return void ctx.answerCbQuery();
    }
    if(data.startsWith('menu:sec:')){
      const sec=decodeURIComponent(data.split(':').slice(2).join(':'));
      const gs=(await getGatesFrom(`${chatId}`)).filter(g=>(g.section||'اصلی')===sec);
      const toIds=gs.map(g=>`${g.to_chat_id}`); const lm=await fetchLockMap([...new Set(toIds)]);
      const rows=[];
      for(const g of gs.slice(0,24)){ const locked=!!lm[`${g.to_chat_id}`]; const text=`${locked?'⛔️ ':''}${g.emoji||'🧭'} ${g.label} — ${humanize(g.base_travel_sec)}`; rows.push([Markup.button.callback(text,`ticket:gate:${g.id}:${g.base_travel_sec}`)]); }
      rows.push([Markup.button.callback('⬅️ صفحات','menu:sections')]);
      try{ await ctx.editMessageText(`مسیرهای بخش «${sec}»:`,Markup.inlineKeyboard(rows,{columns:1})); }catch{}
      return void ctx.answerCbQuery();
    }

    // ===== ticket (works in PV & group) =====
    if(data.startsWith('ticket:gate:')){
      const p=data.split(':'); const gateId=p[2]; const etaSec=parseInt(p[3],10);
      const {data:g}=await supa.from('gates').select('id,from_chat_id,to_chat_id,base_travel_sec').eq('id',gateId).maybeSingle();
      if(!g){ await ctx.answerCbQuery('مسیر نامعتبر'); return; }
      const st=await getRegionState(`${g.to_chat_id}`); if(st.locked){ await ctx.answerCbQuery(st.msg||'⛔️ منطقه بسته است'); return; }

      const link=await bot.telegram.createChatInviteLink(g.to_chat_id,{expire_date:Math.floor(Date.now()/1000)+300,member_limit:1,creates_join_request:true,name:`ticket-${userId}-${gateId}`});
      const moveId=newMoveId(userId,gateId); const depart=nowIso(); const arrive=new Date(Date.now()+etaSec*1000).toISOString();

      await upsertPlayer({user_id:userId,current_chat_id:`${g.to_chat_id}`,last_chat_id:`${g.from_chat_id}`,status:'quarantined',updated_at:depart});
      await upsertMovement({move_id:moveId,user_id:userId,from_chat_id:`${g.from_chat_id}`,to_chat_id:`${g.to_chat_id}`,gate_id:gateId,departed_at:depart,arrive_at:arrive,state:'scheduled',ticket_id:moveId,ticket_expires_at:new Date(Date.now()+5*60*1000).toISOString(),invite_link:link.invite_link});
      kickOthers(`${g.to_chat_id}`,userId).catch(()=>{});
      scheduleArrival({move_id:moveId,arrive_at:arrive,to_chat_id:g.to_chat_id,user_id:userId});

      try{
        await bot.telegram.sendMessage(userId,'🎟️ بلیت مقصد آماده شد.\n\nبرای ورود کلیک کن:',Markup.inlineKeyboard([[Markup.button.url('ورود به مقصد',link.invite_link)]]));
        await ctx.answerCbQuery('لینک در PV ارسال شد');
      }catch{ await ctx.answerCbQuery('PV بات را استارت کن'); }

      if(chatType==='private'){ try{ await ctx.deleteMessage(); }catch{} } // پاک‌کردن منوی PV
      return;
    }

    await ctx.answerCbQuery();
  }catch{ try{ await ctx.answerCbQuery('خطا'); }catch{} }
});

// join request
bot.on('chat_join_request', async (ctx)=>{
  try{
    const req=ctx.update.chat_join_request; const userId=req.from.id; const chatId=`${req.chat.id}`; const used=req.invite_link?.invite_link||'';
    const st=await getRegionState(chatId); if(st.locked){ await ctx.declineChatJoinRequest(userId); return; }
    const {data}=await supa.from('movements').select('ticket_expires_at,invite_link,state').eq('user_id',userId).eq('to_chat_id',chatId).eq('state','scheduled').order('departed_at',{ascending:false}).limit(1);
    const mv=data&&data[0]; if(!mv){ await ctx.declineChatJoinRequest(userId); return; }
    const notExpired=new Date(mv.ticket_expires_at)>new Date(); const linkOk=mv.invite_link===used;
    if(notExpired&&linkOk){ await ctx.approveChatJoinRequest(userId); await supa.from('players').upsert({user_id:userId,current_chat_id:chatId,status:'quarantined',updated_at:nowIso()},{onConflict:'user_id'}); }
    else{ await ctx.declineChatJoinRequest(userId); }
  }catch{}
});

// group text triggers (SILENT #ورود)
async function handleVorud(ctx){
  const chatId=`${ctx.chat?.id}`; const userId=ctx.from?.id; if(!chatId||!userId) return;
  const allowed=await ensureAllowedChat(chatId); if(!allowed) return; // بی‌صدا
  try{ await sendMenuToPV(chatId,userId); }catch{} // حتی اگر PV بسته باشد، در گروه پیام نمی‌دهیم
}
async function handleKhoroj(ctx){
  const u=ctx.message?.from; if(!u||u.is_bot) return;
  try{ await ctx.reply(`🧭┊سفر به سلامت ${u.first_name||''}`,{reply_to_message_id:ctx.message.message_id}); }catch{}
}
bot.on('text', async (ctx,next)=>{ if(ctx.chat?.type==='private') return next(); const t=ctx.message?.text||''; if(isTrigger(t,'ورود')) return handleVorud(ctx); if(isTrigger(t,'خروج')) return handleKhoroj(ctx); return next(); });

// commands
bot.start((ctx)=>ctx.reply('نینجا در خدمت شماست 🥷🏻'));
bot.command('on', async (ctx)=>{ if(!ensureOwner(ctx))return; const id=`${ctx.chat.id}`, title=ctx.chat.title||'بدون عنوان';
  const {error}=await supa.from('registered_chats').upsert({chat_id:id,title,created_at:nowIso()},{onConflict:'chat_id'});
  cache.del(`allowed:${id}`); cache.del('registered:list'); cache.del(`region:${id}`); cache.del(`title:${id}`);
  if(error) return ctx.reply('❌ خطا در ثبت منطقه'); ctx.reply('✅ منطقه ثبت شد'); });
bot.command('off', async (ctx)=>{ if(!ensureOwner(ctx))return; const id=`${ctx.chat.id}`; await supa.from('registered_chats').delete().eq('chat_id',id);
  cache.del(`allowed:${id}`); cache.del('registered:list'); cache.del(`region:${id}`); cache.del(`title:${id}`); try{ await ctx.leaveChat(); }catch{} });
bot.command('lock', async (ctx)=>{ if(!ensureOwner(ctx))return; const id=`${ctx.chat.id}`; await supa.from('registered_chats').update({locked:true}).eq('chat_id',id); cache.del(`region:${id}`); });
bot.command('unlock', async (ctx)=>{ if(!ensureOwner(ctx))return; const id=`${ctx.chat.id}`; await supa.from('registered_chats').update({locked:false}).eq('chat_id',id); cache.del(`region:${id}`); });
bot.command('toggle_lock', async (ctx)=>{ if(!ensureOwner(ctx))return; const id=`${ctx.chat.id}`; const st=await getRegionState(id); await supa.from('registered_chats').update({locked:!st.locked}).eq('chat_id',id); cache.del(`region:${id}`); });
bot.command('vip', async (ctx)=>{ if(!ensureOwner(ctx))return; const t=ctx.message?.reply_to_message?.from; if(!t) return ctx.reply('روی پیام کاربر ریپلای کن بعد /vip بزن');
  await supa.from('vip_users').upsert({user_id:t.id,added_at:nowIso()},{onConflict:'user_id'}); await supa.from('players').delete().eq('user_id',t.id); ctx.reply(`✅ ${t.first_name} VIP شد`); });
bot.command('unvip', async (ctx)=>{ if(!ensureOwner(ctx))return; const t=ctx.message?.reply_to_message?.from; if(!t) return ctx.reply('روی پیام کاربر ریپلای کن بعد /unvip بزن');
  await supa.from('vip_users').delete().eq('user_id',t.id); ctx.reply(`✅ ${t.first_name} از VIP خارج شد`); });
bot.command('free', async (ctx)=>{ if(!ensureOwner(ctx))return; const t=ctx.message?.reply_to_message?.from; if(!t) return ctx.reply('روی پیام کاربر ریپلای کن بعد /free بزن');
  await supa.from('players').delete().eq('user_id',t.id); ctx.reply(`✅ ${t.first_name} از قرنطینه خارج شد`); });
bot.command('listgates', async (ctx)=>{ if(!ensureOwner(ctx))return; const id=`${ctx.chat.id}`;
  const {data}=await supa.from('gates').select('id,to_chat_id,label,base_travel_sec,inverse_gate_id,section,order_index,active').eq('from_chat_id',id).order('section',{ascending:true}).order('order_index',{ascending:true}).order('id',{ascending:true}).limit(500);
  const rows=(data||[]).filter(g=>g.active!==false); if(!rows.length) return ctx.reply('هیچ مسیری ثبت نیست');
  let out='گیت‌ها:\n'; for(const g of rows){ out+=`• [${g.section||'اصلی'}] #${g.id} → ${g.to_chat_id} | ${g.label} | ${g.base_travel_sec}s${g.inverse_gate_id?` (↔ ${g.inverse_gate_id})`:''}\n`; } ctx.reply(out);
});
bot.command('unlink', async (ctx)=>{ if(!ensureOwner(ctx))return; const p=(ctx.message.text||'').trim().split(/\s+/); if(p.length<3) return ctx.reply('فرمت: /unlink <from_chat_id> <to_chat_id>');
  const [,f,t]=p; await supa.from('gates').delete().eq('from_chat_id',f).eq('to_chat_id',t); await supa.from('gates').delete().eq('from_chat_id',t).eq('to_chat_id',f); cache.del(`gates:${f}`); cache.del(`gates:${t}`); ctx.reply('✅ حذف شد'); });

// فقط مالک می‌تواند بات را به گروه اضافه کند
bot.on('my_chat_member', async (ctx)=>{ try{ const ns=ctx.update.my_chat_member?.new_chat_member?.status; const adder=ctx.update.my_chat_member?.from?.id; const chatId=ctx.chat?.id;
  if(ns&&['member','administrator'].includes(ns)){ if(adder!==OWNER_ID){ try{ await bot.telegram.sendMessage(chatId,'این ربات متعلق به مجموعه اکلیس است ، شما حق استفاده از آنها رو ندارین ، حدتو بدون'); }catch{} try{ await bot.telegram.leaveChat(chatId); }catch{} } } }catch{} });

// Wizard state (PV)
const wizard=new Map(); // uid->state
const stOf=(uid)=>{ if(!wizard.has(uid)) wizard.set(uid,{step:0}); return wizard.get(uid); };
async function ensurePV(uid){ try{ await bot.telegram.sendChatAction(uid,'typing'); return true; }catch{ return false; } }
async function pagedChats(page=1,size=8,exclude=null){
  const k='registered:list:all'; let list=cache.get(k);
  if(!list){ const {data}=await supa.from('registered_chats').select('chat_id,title').order('title',{ascending:true}).limit(5000); list=data||[]; cache.set(k,list,300); }
  const arr=exclude?list.filter(x=>`${x.chat_id}`!==`${exclude}`):list; const pages=Math.max(1,Math.ceil(arr.length/size));
  const items=arr.slice((page-1)*size,(page-1)*size+size); return {items,page,pages};
}
async function startWizardPV(uid,lastGroupId){
  if(!await ensurePV(uid)) return false;
  const kb=Markup.inlineKeyboard([
    [Markup.button.callback('✔️ مبدأ = آخرین گروه فراخوان', 'wz:from:this')],
    [Markup.button.callback('📜 انتخاب مبدأ از لیست', 'wz:from:list:1')],
    [Markup.button.callback('🔎 جستجوی مبدأ با آیدی', 'wz:from:find')],
    [Markup.button.callback('❌ لغو','wz:cancel')]
  ]);
  await safeSendMessage(uid,'وِیزارد لینک: مبدأ را انتخاب کن.',kb);
  const st=stOf(uid); st.step=1; st.lastGroupId=lastGroupId||null; return true;
}
bot.command('link_wizard', async (ctx)=>{
  if(!ensureOwner(ctx)) return;
  const uid=ctx.from.id; const started=await startWizardPV(uid,ctx.chat?.type!=='private'?`${ctx.chat.id}`:null);
  if(ctx.chat?.type!=='private'){ try{ await ctx.reply('ادامه‌ی ویزارد در PV شما انجام می‌شود.'); }catch{} }
  if(!started) return ctx.reply('ابتدا در PV بات را /start کن.');
});

// Wizard text inputs (PV only)
bot.on('text', async (ctx,next)=>{
  if(ctx.chat?.type!=='private') return next();
  if(!isOwner(ctx)) return next();
  const uid=ctx.from.id; const st=wizard.get(uid); if(!st) return next();

  // fromId/toId quick input
  if(st.step==='fromIdInput' || st.step==='toIdInput'){
    const raw=(ctx.message.text||'').trim();
    if(!/^-?\d{6,20}$/.test(raw)) return safeSendMessage(uid,'⛔️ آیدی عددی نامعتبر است.');
    const {data}=await supa.from('registered_chats').select('chat_id,title').eq('chat_id',raw).maybeSingle();
    if(!data) return safeSendMessage(uid,'❌ چنین آیدی در مناطق ثبت‌شده نیست.');
    const confirmKey=st.step==='fromIdInput'?`wz:from:confirm:${raw}`:`wz:to:confirm:${raw}`;
    return safeSendMessage(uid,`آیا منظورت این گروه است؟\n${data.title||'-'}\n${data.chat_id}`,
      Markup.inlineKeyboard([[Markup.button.callback('✅ بله',confirmKey)],[Markup.button.callback('↩️ برگشت','wz:from:list:1')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }

  if(st.step===3){ st.labelF=(ctx.message.text||'').trim();
    st.step='secMode';
    return safeSendMessage(uid,'نام بخش/صفحه را انتخاب کن:',Markup.inlineKeyboard([[Markup.button.callback('📂 «اصلی»','wz:sec:default')],[Markup.button.callback('✍️ دستی','wz:sec:manual')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }
  if(st.step==='secInput'){ st.section=(ctx.message.text||'').trim()||'اصلی';
    st.step='labelBackMode';
    return safeSendMessage(uid,'لیبل برگشت؟',Markup.inlineKeyboard([[Markup.button.callback('✨ خودکار','wz:label:auto')],[Markup.button.callback('✍️ دستی','wz:label:manual')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }
  if(st.step==='labelBInput'){ st.labelB=(ctx.message.text||'').trim(); st.step=4;
    return safeSendMessage(uid,'⏱ زمان رفت (ثانیه): یا دکمهٔ زیر',Markup.inlineKeyboard([[Markup.button.callback('پیش‌فرض 300','wz:tf:default')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }
  if(st.step===4){ const t=(ctx.message.text||'').trim(); st.tf=t.toLowerCase()==='default'?300:parseInt(t,10);
    if(!Number.isFinite(st.tf)||st.tf<=0) return safeSendMessage(uid,'⛔️ عدد معتبر بفرست یا «default».');
    st.step=5; return safeSendMessage(uid,'⏱ زمان برگشت (ثانیه): یا دکمهٔ زیر',Markup.inlineKeyboard([[Markup.button.callback('پیش‌فرض 300','wz:tb:default')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }
  if(st.step===5){ const t=(ctx.message.text||'').trim(); st.tb=t.toLowerCase()==='default'?300:parseInt(t,10);
    if(!Number.isFinite(st.tb)||st.tb<=0) return safeSendMessage(uid,'⛔️ عدد معتبر بفرست یا «default».');
    st.step=6;
    const summary=`بررسی نهایی:\nfrom: ${st.fromId}\nto: ${st.toId}\nsection: ${st.section||'اصلی'}\nlabel→: ${st.labelF}\nlabel←: ${st.labelB||'(auto)'}\nforward: ${st.tf}s\nback: ${st.tb}s`;
    return safeSendMessage(uid,summary,Markup.inlineKeyboard([[Markup.button.callback('✅ ایجاد','wz:confirm')],[Markup.button.callback('↩️ ویرایش زمان‌ها','wz:edit_times')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }

  return next();
});

// Wizard callbacks (PV only)
bot.on('callback_query', async (ctx,next)=>{
  const data=ctx.callbackQuery?.data||'';
  if(!data.startsWith('wz:')) return next();
  if(ctx.chat?.type!=='private'){ await ctx.answerCbQuery('ویزارد در PV اجرا می‌شود'); return; }
  if(!isOwner(ctx)){ await ctx.answerCbQuery(); return; }
  const uid=ctx.from.id; const st=stOf(uid);

  const reply=async (text,kb)=>{ try{ await ctx.editMessageText(text,kb); }catch{ await safeSendMessage(uid,text,kb);} await ctx.answerCbQuery(); };

  if(data==='wz:cancel'){ wizard.delete(uid); try{ await ctx.editMessageText('وِیزارد لغو شد.'); }catch{ await safeSendMessage(uid,'وِیزارد لغو شد.'); } return; }
  if(data==='wz:from:this'){
    st.fromId=st.lastGroupId||null;
    if(!st.fromId) return reply('مبدأ مشخص نیست.',Markup.inlineKeyboard([[Markup.button.callback('📜 انتخاب از لیست','wz:from:list:1')],[Markup.button.callback('🔎 جستجو با آیدی','wz:from:find')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
    st.step=2; return reply(`مبدأ تنظیم شد: ${st.fromId}`,Markup.inlineKeyboard([[Markup.button.callback('📜 انتخاب مقصد','wz:to:list:1')],[Markup.button.callback('🔎 جستجوی مقصد','wz:to:find')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }
  if(data.startsWith('wz:from:list:')){
    const page=parseInt(data.split(':').pop(),10)||1; const {items,pages}=await pagedChats(page,8,null);
    const rows=items.map(it=>[Markup.button.callback(`${it.title||it.chat_id}`,`wz:from:set:${it.chat_id}`)]);
    rows.push([Markup.button.callback('◀️',`wz:from:list:${Math.max(1,page-1)}`),Markup.button.callback(`${page}/${pages}`,'wz:nop'),Markup.button.callback('▶️',`wz:from:list:${Math.min(pages,page+1)}`)]);
    rows.push([Markup.button.callback('🔎 جستجو با آیدی','wz:from:find')],[Markup.button.callback('❌ لغو','wz:cancel')]);
    return reply('مبدأ را انتخاب کن:',Markup.inlineKeyboard(rows,{columns:1}));
  }
  if(data==='wz:from:find'){ st.step='fromIdInput'; return reply('آیدی عددی مبدأ را بفرست.',Markup.inlineKeyboard([[Markup.button.callback('❌ لغو','wz:cancel')]])); }
  if(data.startsWith('wz:from:set:')){ st.fromId=data.split(':').pop(); st.step=2;
    return reply(`مبدأ: ${st.fromId}`,Markup.inlineKeyboard([[Markup.button.callback('📜 انتخاب مقصد','wz:to:list:1')],[Markup.button.callback('🔎 جستجوی مقصد','wz:to:find')],[Markup.button.callback('❌ لغو','wz:cancel')]])); }
  if(data.startsWith('wz:from:confirm:')){ st.fromId=data.split(':').pop(); st.step=2;
    return reply(`مبدأ: ${st.fromId}`,Markup.inlineKeyboard([[Markup.button.callback('📜 انتخاب مقصد','wz:to:list:1')],[Markup.button.callback('🔎 جستجوی مقصد','wz:to:find')],[Markup.button.callback('❌ لغو','wz:cancel')]])); }

  if(data.startsWith('wz:to:list:')){
    const page=parseInt(data.split(':').pop(),10)||1; const {items,pages}=await pagedChats(page,8,st.fromId);
    const rows=items.map(it=>[Markup.button.callback(`${it.title||it.chat_id}`,`wz:to:set:${it.chat_id}`)]);
    rows.push([Markup.button.callback('◀️',`wz:to:list:${Math.max(1,page-1)}`),Markup.button.callback(`${page}/${pages}`,'wz:nop'),Markup.button.callback('▶️',`wz:to:list:${Math.min(pages,page+1)}`)]);
    rows.push([Markup.button.callback('🔎 جستجو با آیدی','wz:to:find')],[Markup.button.callback('↩️ تغییر مبدأ','wz:from:list:1')],[Markup.button.callback('❌ لغو','wz:cancel')]);
    return reply('مقصد را انتخاب کن:',Markup.inlineKeyboard(rows,{columns:1}));
  }
  if(data==='wz:to:find'){ st.step='toIdInput'; return reply('آیدی عددی مقصد را بفرست.',Markup.inlineKeyboard([[Markup.button.callback('❌ لغو','wz:cancel')]])); }
  if(data.startsWith('wz:to:set:')){ st.toId=data.split(':').pop(); st.step=3; return reply(`مبدأ: ${st.fromId}\nمقصد: ${st.toId}\n\nلیبلِ رفت را بنویس (مثلاً «ورود به شهر»).`); }
  if(data.startsWith('wz:to:confirm:')){ st.toId=data.split(':').pop(); st.step=3; return reply(`مبدأ: ${st.fromId}\nمقصد: ${st.toId}\n\nلیبلِ رفت را بنویس.`); }

  if(data==='wz:sec:default'){ st.section='اصلی'; st.step='labelBackMode';
    return reply('لیبل برگشت؟',Markup.inlineKeyboard([[Markup.button.callback('✨ خودکار','wz:label:auto')],[Markup.button.callback('✍️ دستی','wz:label:manual')],[Markup.button.callback('❌ لغو','wz:cancel')]])); }
  if(data==='wz:sec:manual'){ st.step='secInput'; return reply('نام بخش/صفحه را بفرست.',Markup.inlineKeyboard([[Markup.button.callback('❌ لغو','wz:cancel')]])); }

  if(data==='wz:label:auto'){ const t=await getChatTitle(st.fromId); st.labelB=`بازگشت به ${t}`; st.step=4;
    return reply('⏱ زمان رفت (ثانیه):',Markup.inlineKeyboard([[Markup.button.callback('پیش‌فرض 300','wz:tf:default')],[Markup.button.callback('❌ لغو','wz:cancel')]])); }
  if(data==='wz:label:manual'){ st.step='labelBInput'; return reply('لیبل برگشت را بنویس.',Markup.inlineKeyboard([[Markup.button.callback('❌ لغو','wz:cancel')]])); }
  if(data==='wz:tf:default'){ st.tf=300; st.step=5; return reply('⏱ زمان برگشت (ثانیه):',Markup.inlineKeyboard([[Markup.button.callback('پیش‌فرض 300','wz:tb:default')],[Markup.button.callback('❌ لغو','wz:cancel')]])); }
  if(data==='wz:tb:default'){ st.tb=300; st.step=6;
    const summary=`بررسی نهایی:\nfrom: ${st.fromId}\nto: ${st.toId}\nsection: ${st.section||'اصلی'}\nlabel→: ${st.labelF}\nlabel←: ${st.labelB||'(auto)'}\nforward: ${st.tf}s\nback: ${st.tb}s`;
    return reply(summary,Markup.inlineKeyboard([[Markup.button.callback('✅ ایجاد','wz:confirm')],[Markup.button.callback('↩️ ویرایش زمان‌ها','wz:edit_times')],[Markup.button.callback('❌ لغو','wz:cancel')]])); }
  if(data==='wz:edit_times'){ st.step=4; return reply('⏱ زمان رفت (ثانیه):',Markup.inlineKeyboard([[Markup.button.callback('پیش‌فرض 300','wz:tf:default')],[Markup.button.callback('❌ لغو','wz:cancel')]])); }

  if(data==='wz:confirm'){
    if(!st.fromId||!st.toId||!st.labelF||!st.tf||!st.tb) return ctx.answerCbQuery('اطلاعات ناقص است');
    const section=st.section||'اصلی';
    const f={from_chat_id:st.fromId,to_chat_id:st.toId,label:st.labelF,emoji:'🧭',base_travel_sec:parseInt(st.tf,10),invite_url:'-',active:true,section,order_index:0};
    const backLbl=st.labelB||`بازگشت به ${await getChatTitle(st.fromId)}`;
    const b={from_chat_id:st.toId,to_chat_id:st.fromId,label:backLbl,emoji:'🧭',base_travel_sec:parseInt(st.tb,10),invite_url:'-',active:true,section,order_index:0};
    const {data:fd}=await supa.from('gates').insert(f).select('id').single();
    const {data:bd}=await supa.from('gates').insert(b).select('id').single();
    if(fd?.id&&bd?.id){ await supa.from('gates').update({inverse_gate_id:bd.id}).eq('id',fd.id); await supa.from('gates').update({inverse_gate_id:fd.id}).eq('id',bd.id); }
    cache.del(`gates:${st.fromId}`); cache.del(`gates:${st.toId}`);
    wizard.delete(uid);
    return reply('✅ لینک‌های رفت/برگشت ساخته شد');
  }

  await ctx.answerCbQuery();
});

// keepalive
function startPing(){ if(!RENDER_URL) return; const url=RENDER_URL; setInterval(()=>axios.head(`${url}/ping`).catch(()=>{}), 13*60*1000+59*1000); }
app.get('/ping',(_req,res)=>res.status(200).json({ok:true}));
setInterval(async()=>{ const ts=nowIso(); await supa.from('footprints').delete().lt('expires_at',ts).catch(()=>{}); await supa.from('relay_candles').delete().lt('expires_at',ts).catch(()=>{}); },180_000);

app.use(bot.webhookCallback('/webhook'));
app.get('/',(_req,res)=>res.send('<h3>RPG World Bot</h3>'));
app.listen(PORT, async ()=>{
  console.log('🚀 Bot on',PORT); startPing();
  try{ await bot.telegram.deleteWebhook({drop_pending_updates:true});
    if(RENDER_URL){ const url=`${RENDER_URL}/webhook`; await bot.telegram.setWebhook(url); console.log('✅ Webhook:',url); }
    else{ await bot.launch(); console.log('✅ Long polling'); }
  }catch(e){ console.log('Startup warn:',e.message); }
  try{ await bootCatchUp(); }catch{}
});
process.on('unhandledRejection',e=>console.log('Unhandled:',e?.message||e));
