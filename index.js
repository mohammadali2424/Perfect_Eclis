// RPG World Bot — Unified (Quarantine + Trigger + Wizard + Private Editor)
// Render/Supabase Free Friendly — Text-only + Inline buttons

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
  console.error('❌ ENV لازم: BOT_TOKEN, OWNER_ID, SUPABASE_URL, SUPABASE_KEY');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 9000 });
const supa = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const app = express(); app.use(express.json());
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120, maxKeys: 10000 });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('LOCAL_TIMEOUT')), ms))]);

let ME_ID = null; (async () => { try { ME_ID = (await bot.telegram.getMe()).id; } catch {} })();

const isOwner = (ctx) => ctx.from?.id === OWNER_ID;
const replyNotOwner = async (ctx) => { try { await ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده', { reply_to_message_id: ctx.message?.message_id }); } catch {} };

async function isBotAdmin(chatId) {
  const k = `admin:${chatId}`, c = cache.get(k); if (c !== undefined) return c;
  try { const me = await bot.telegram.getChatMember(chatId, ME_ID); const ok = ['administrator','creator'].includes(me.status); cache.set(k, ok, 600); return ok; }
  catch { cache.set(k, false, 120); return false; }
}

async function ensureAllowedChat(chatId) {
  const k = `allowed:${chatId}`, c = cache.get(k); if (c !== undefined) return c;
  try { const { data, error } = await withTimeout(supa.from('registered_chats').select('chat_id').eq('chat_id', `${chatId}`).single(), 5000);
        const ok = !error && !!data; cache.set(k, ok, 600); return ok; }
  catch { cache.set(k, false, 120); return false; }
}

// ---------------- Rate limit (global queue) ----------------
const globalQueue = []; let sending = false; const SEND_RATE_DELAY = 70;
async function enqueueSend(fn){ return new Promise((resolve)=>{ globalQueue.push({fn, resolve}); if(!sending) pump(); }); }
async function pump(){ sending = true; while(globalQueue.length){ const {fn, resolve} = globalQueue.shift(); try{ resolve(await fn()); }catch(e){ resolve(Promise.reject(e)); } await sleep(SEND_RATE_DELAY);} sending=false; }
async function safeSendMessage(chatId, text, extra={}) {
  try { return await enqueueSend(()=>bot.telegram.sendMessage(chatId, text, extra)); }
  catch (e){ const m=String(e.message||e); if(/429|timeout|ETELEGRAM/.test(m)){ await sleep(500); try{ return await enqueueSend(()=>bot.telegram.sendMessage(chatId,text,extra)); }catch{} } throw e; }
}

// ---------------- DB helpers ----------------
async function getGatesFrom(fromChatId){
  const k=`gates:${fromChatId}`, c=cache.get(k); if(c) return c;
  const { data, error } = await withTimeout(
    supa.from('gates').select('id,from_chat_id,to_chat_id,label,emoji,base_travel_sec,invite_url,active,rule_json,inverse_gate_id')
        .eq('from_chat_id', `${fromChatId}`).eq('active', true).limit(400), 7000);
  if (error) return []; cache.set(k, data||[], 600); return data||[];
}
async function upsertPlayer(p){ await supa.from('players').upsert(p, { onConflict: 'user_id' }); }
async function upsertMovement(m){ await supa.from('movements').upsert(m, { onConflict: 'move_id' }); }
function newMoveId(userId, gateId){ return `${userId}_${gateId}_${Date.now()}`; }

// ---------------- One-time invite ----------------
async function createOneTimeInvite(destChatId, userId, gateId, ttlSec){
  const expireAt = Math.floor(Date.now()/1000) + Math.max(60, Math.min(ttlSec, 600));
  return await bot.telegram.createChatInviteLink(destChatId, {
    expire_date: expireAt, member_limit: 1, creates_join_request: true, name: `ticket-${userId}-${gateId}`
  });
}

// ---------------- Quarantine & Soft removal ----------------
async function softKickFromChat(chatId, userId){
  try{
    if (!await isBotAdmin(chatId)) return false;
    try{ const m = await bot.telegram.getChatMember(chatId, userId); if(['left','kicked','creator'].includes(m.status)) return true; }catch{}
    await bot.telegram.banChatMember(chatId, userId);
    setTimeout(()=>bot.telegram.unbanChatMember(chatId, userId).catch(()=>{}), 10_000);
    await sleep(80); return true;
  }catch{ return false; }
}
async function removeFromOtherChats(allowedChatId, userId){
  let regs = cache.get('registered:list');
  if(!regs){ const {data}=await supa.from('registered_chats').select('chat_id').limit(2000); regs=data||[]; cache.set('registered:list', regs, 600); }
  for(const r of regs){ const cid = `${r.chat_id}`; if(cid===`${allowedChatId}`) continue; await softKickFromChat(cid, userId); }
}

// ---------------- Arrival menu ----------------
function humanizeSeconds(sec){ sec=Math.max(1,Math.round(sec)); if(sec<60) return `${sec} ثانیه`; const m=Math.floor(sec/60), s=sec%60; return s?`${m} دقیقه و ${s} ثانیه`:`${m} دقیقه`; }

async function buildMenuFor(chatId, userId){
  const gates = await getGatesFrom(chatId);
  // 👣 Footprint
  let footprintBtn=null;
  try{
    const { data: fps } = await supa.from('footprints')
      .select('user_display, origin_chat_id, expires_at').eq('chat_id', `${chatId}`)
      .gt('expires_at', nowIso()).order('expires_at',{ascending:false}).limit(1);
    if(fps?.length){ footprintBtn = { text:`👣 پی‌گرفتن ردِ ${fps[0].user_display||'مسافر'} — 2 دقیقه`, data:`ticket:footprint:${fps[0].origin_chat_id}:120` }; }
  }catch{}

  const rows=[];
  for(const g of gates.slice(0,48)){
    let eta=g.base_travel_sec;
    try{
      const { data: c } = await supa.from('relay_candles').select('charges_left,expires_at').eq('gate_id', g.id).single();
      if(c && c.charges_left>0 && new Date(c.expires_at)>new Date()) eta=Math.round(eta*0.95);
    }catch{}
    const label=`${g.emoji||'🧭'} ${g.label} — ${humanizeSeconds(eta)}`;
    rows.push([Markup.button.callback(label, `ticket:gate:${g.id}:${eta}`)]);
  }
  if(footprintBtn) rows.unshift([Markup.button.callback(footprintBtn.text, footprintBtn.data)]);
  return Markup.inlineKeyboard(rows, { columns: 1 });
}

async function sendArrivalMessage(destChatId, userId){
  const kb = await buildMenuFor(destChatId, userId);
  await safeSendMessage(destChatId, '🎴┊وارد شدی؛ هوای اینجا بوی ماجرا می‌دهد...\n\nمسیرهای پیشِ رو:', kb);
}

// ---------------- Scheduler ----------------
const scheduledJobs=new Map();
async function scheduleArrival(move){
  const delay=Math.max(0,new Date(move.arrive_at).getTime()-Date.now());
  if(delay>60*60*1000) return;
  if(scheduledJobs.has(move.move_id)) return;
  const tid=setTimeout(async()=>{
    scheduledJobs.delete(move.move_id);
    try{
      const { data: m } = await supa.from('movements').select('state,to_chat_id,user_id,gate_id').eq('move_id', move.move_id).single();
      if(!m || m.state!=='scheduled') return;
      await sendArrivalMessage(m.to_chat_id, m.user_id);
      await supa.from('players').upsert({ user_id:m.user_id, status:'idle', updated_at: nowIso() }, { onConflict:'user_id' });
      const { data: pl } = await supa.from('players').select('last_chat_id').eq('user_id', m.user_id).single();
      await supa.from('footprints').upsert({
        chat_id:`${m.to_chat_id}`, user_id:m.user_id, origin_chat_id: pl?.last_chat_id||null, user_display:'', expires_at: new Date(Date.now()+120000).toISOString()
      });
      if(m.gate_id){
        await supa.from('relay_candles').upsert({ gate_id:m.gate_id, charges_left:3, expires_at:new Date(Date.now()+300000).toISOString() });
      }
      await supa.from('movements').update({ state:'arrived' }).eq('move_id', move.move_id);
    }catch{}
  }, delay);
  scheduledJobs.set(move.move_id, tid);
}
async function bootCatchUp(){
  const from=new Date(Date.now()-120000).toISOString(), to=new Date(Date.now()+120000).toISOString();
  const { data } = await supa.from('movements').select('move_id,user_id,to_chat_id,arrive_at,state,gate_id').eq('state','scheduled').gte('arrive_at',from).lte('arrive_at',to).limit(500);
  for(const m of (data||[])) scheduleArrival(m);
}

// ---------------- Callback router ----------------
bot.on('callback_query', async (ctx)=>{
  try{
    const cb=ctx.callbackQuery, data=cb.data||''; const chatType=ctx.chat?.type;

    // PV Editor callbacks
    if(chatType==='private' && data.startsWith('edit:')) return handleEditCallbacks(ctx, data);

    // In-group tickets
    if((chatType==='supergroup' || chatType==='group') && data.startsWith('ticket:')){
      const chatId=ctx.chat.id, userId=cb.from.id;
      if(!await ensureAllowedChat(chatId)) return ctx.answerCbQuery('منطقه فعال نیست');

      let toChatId=null, etaSec=null, gateId=null;
      if(data.startsWith('ticket:gate:')){
        const [, , , gId, etaStr]=data.split(':'); gateId=parseInt(gId,10); etaSec=parseInt(etaStr,10);
        const { data: g } = await supa.from('gates').select('id,from_chat_id,to_chat_id,base_travel_sec').eq('id', gateId).single();
        if(!g || `${g.from_chat_id}`!==`${chatId}`) return ctx.answerCbQuery('مسیر نامعتبر');
        toChatId=g.to_chat_id;
        try{ await supa.rpc('consume_candle', { p_gate_id: gateId }); }catch{}
      }else if(data.startsWith('ticket:footprint:')){
        const [, , , originChatId, etaStr]=data.split(':'); toChatId=originChatId; etaSec=parseInt(etaStr,10); gateId=null;
      }else return ctx.answerCbQuery();

      const link = await createOneTimeInvite(toChatId, userId, gateId||0, 300);
      const moveId=newMoveId(userId, gateId||0); const depart=nowIso(); const arrive=new Date(Date.now()+etaSec*1000).toISOString();

      await upsertPlayer({ user_id:userId, current_chat_id:`${toChatId}`, last_chat_id:`${chatId}`, status:'quarantined', updated_at:depart });
      await upsertMovement({
        move_id:moveId,user_id:userId,from_chat_id:`${chatId}`,to_chat_id:`${toChatId}`,gate_id:gateId,departed_at:depart,arrive_at:arrive,state:'scheduled',
        ticket_id:moveId, ticket_expires_at:new Date(Date.now()+300000).toISOString(), invite_link: link.invite_link
      });
      removeFromOtherChats(`${toChatId}`, userId).catch(()=>{});
      scheduleArrival({ move_id:moveId, arrive_at:arrive, gate_id:gateId, to_chat_id:toChatId, user_id:userId });

      try{
        await bot.telegram.sendMessage(userId, '🎟️ بلیت مقصد آماده شد.\nبرای ورود کلیک کن:', Markup.inlineKeyboard([[Markup.button.url('ورود به مقصد', link.invite_link)]]));
        await ctx.answerCbQuery('لینک در PV ارسال شد');
      }catch{
        await ctx.answerCbQuery('PV من را استارت کن'); await safeSendMessage(chatId, `[${cb.from.first_name}](tg://user?id=${userId}) PV بات را استارت کن`, { parse_mode:'Markdown' });
      }
      return;
    }

    return ctx.answerCbQuery();
  }catch{ try{ await ctx.answerCbQuery('خطا'); }catch{} }
});

// ---------------- Join request approval ----------------
bot.on('chat_join_request', async (ctx)=>{
  try{
    const req=ctx.update.chat_join_request; const userId=req.from.id; const chatId=`${req.chat.id}`; const used=req.invite_link?.invite_link||'';
    const { data } = await supa.from('movements').select('move_id,state,to_chat_id,user_id,ticket_expires_at,invite_link').eq('user_id',userId).eq('to_chat_id',chatId).eq('state','scheduled').order('departed_at',{ascending:false}).limit(1);
    const mv=(data&&data[0])||null; if(!mv){ await ctx.declineChatJoinRequest(userId); return; }
    const ok=(new Date(mv.ticket_expires_at)>new Date()) && (mv.invite_link===used);
    if(ok){ await ctx.approveChatJoinRequest(userId); await supa.from('players').upsert({ user_id:userId, current_chat_id:chatId, status:'quarantined', updated_at: nowIso() }, { onConflict:'user_id' }); }
    else { await ctx.declineChatJoinRequest(userId); }
  }catch{}
});

// ---------------- Text triggers ----------------
bot.hears(/^#خروج$/i, async (ctx)=>{ const u=ctx.message?.from; if(!u||u.is_bot) return; try{ await ctx.reply(`🧭┊سفر به سلامت ${u.first_name||''}`, { reply_to_message_id: ctx.message.message_id }); }catch{} });

// ---------------- Core commands ----------------
bot.start((ctx)=>ctx.reply('نینجا در خدمت شماست 🥷🏻'));

bot.command('on', async (ctx)=>{ if(!isOwner(ctx)) return replyNotOwner(ctx);
  const chatId=`${ctx.chat.id}`, title=ctx.chat.title||'بدون عنوان';
  const { error } = await supa.from('registered_chats').upsert({ chat_id:chatId, title, created_at: nowIso() },{ onConflict:'chat_id' });
  cache.del(`allowed:${chatId}`); cache.del('registered:list');
  return ctx.reply(error? '❌ خطا در ثبت منطقه':'✅ منطقه ثبت شد');
});

bot.command('off', async (ctx)=>{ if(!isOwner(ctx)) return replyNotOwner(ctx);
  const chatId=`${ctx.chat.id}`; await supa.from('registered_chats').delete().eq('chat_id', chatId);
  cache.del(`allowed:${chatId}`); cache.del('registered:list');
  await ctx.reply('✅ منطقه حذف شد؛ ربات لفت می‌دهد…'); try{ await ctx.leaveChat(); }catch{}
});

bot.command('vip', async (ctx)=>{ if(!isOwner(ctx)) return replyNotOwner(ctx);
  const t=ctx.message?.reply_to_message?.from; if(!t) return ctx.reply('روی پیام کاربر ریپلای کن بعد /vip');
  await supa.from('vip_users').upsert({ user_id:t.id, added_at:nowIso() },{ onConflict:'user_id' });
  await supa.from('players').delete().eq('user_id', t.id);
  ctx.reply(`✅ ${t.first_name} VIP شد`);
});
bot.command('unvip', async (ctx)=>{ if(!isOwner(ctx)) return replyNotOwner(ctx);
  const t=ctx.message?.reply_to_message?.from; if(!t) return ctx.reply('ریپلای کن بعد /unvip');
  await supa.from('vip_users').delete().eq('user_id', t.id); ctx.reply(`✅ ${t.first_name} از VIP خارج شد`);
});
bot.command('free', async (ctx)=>{ if(!isOwner(ctx)) return replyNotOwner(ctx);
  const t=ctx.message?.reply_to_message?.from; if(!t) return ctx.reply('ریپلای کن بعد /free');
  await supa.from('players').delete().eq('user_id', t.id); ctx.reply(`✅ ${t.first_name} آزاد شد`);
});

// Basic /link (سریع)
bot.command('link', async (ctx)=>{ if(!isOwner(ctx)) return replyNotOwner(ctx);
  const p=(ctx.message.text||'').trim().split(/\s+/); if(p.length<6) return ctx.reply('فرمت: /link <from> <to> <t_f> <t_b> <label>');
  const [,fromId,toId,tf,tb,...lbl]=p; const label=lbl.join(' '), fsec=parseInt(tf,10), bsec=parseInt(tb,10);
  const forward={ from_chat_id:fromId,to_chat_id:toId,label:`${label} (→)`,emoji:'🧭',base_travel_sec:fsec,invite_url:'-',active:true };
  const backward={ from_chat_id:toId,to_chat_id:fromId,label:`${label} (←)`,emoji:'🧭',base_travel_sec:bsec,invite_url:'-',active:true };
  const { data: f } = await supa.from('gates').insert(forward).select('id').single();
  const { data: b } = await supa.from('gates').insert(backward).select('id').single();
  if(f?.id && b?.id){ await supa.from('gates').update({ inverse_gate_id:b.id }).eq('id', f.id); await supa.from('gates').update({ inverse_gate_id:f.id }).eq('id', b.id); }
  cache.del(`gates:${fromId}`); cache.del(`gates:${toId}`); ctx.reply('✅ لینک‌های رفت/برگشت ساخته شد');
});

// ---------------- Wizard: /linkwiz ----------------
const linkWizards = new Map(); // userId -> { step, data, lockFrom? }
function cancelWizard(userId){ linkWizards.delete(userId); }

bot.command('linkwiz', async (ctx)=>{ if(!isOwner(ctx)) return replyNotOwner(ctx);
  linkWizards.set(ctx.from.id, { step:1, data:{} });
  ctx.reply('🧩 ویزارد ساخت مسیر شروع شد.\nگام ۱/۵: شناسهٔ گروه "مبدأ" را بفرست.\n/cancel برای لغو');
});
bot.command('cancel', (ctx)=>{ if(linkWizards.has(ctx.from.id)||editInputs.has(ctx.from.id)){ linkWizards.delete(ctx.from.id); editInputs.delete(ctx.from.id); return ctx.reply('❎ لغو شد.'); } });

bot.on('message', async (ctx)=>{
  // فقط پیام‌های PV برای ویزارد/ویرایش
  if(ctx.chat?.type!=='private') return;
  // Wizard
  const w = linkWizards.get(ctx.from.id);
  if(w){
    const txt=(ctx.message.text||'').trim(); if(!txt) return;
    try{
      if(w.step===1){ w.data.from=txt; w.step=2; return ctx.reply('گام ۲/۵: شناسهٔ گروه "مقصد" را بفرست.'); }
      if(w.step===2){ w.data.to=txt; w.step=3; return ctx.reply('گام ۳/۵: "نوع مسیر" یا بنویس "سفارشی".'); }
      if(w.step===3){
        w.data.kind=txt;
        if(txt!=='سفارشی'){
          const { data:t } = await supa.from('gate_templates').select('forward_sec,backward_sec,default_label,emoji').eq('kind', txt).single();
          if(!t){ w.step=3.5; return ctx.reply('قالبی با این نام نیست؛ زمان رفت (ثانیه) را بفرست.'); }
          w.data.forward=t.forward_sec; w.data.backward=t.backward_sec; w.data.label=t.default_label||txt; w.data.emoji=t.emoji||'🧭'; w.step=5; return ctx.reply(`گام ۴/۵: برچسب را تایید/ویرایش کن (پیش‌فرض: ${w.data.label})`);
        } else { w.step=3.5; return ctx.reply('گام ۳/۵: زمان رفت (ثانیه) را بفرست.'); }
      }
      if(w.step===3.5){ const v=parseInt(txt,10); if(!v||v<1) return ctx.reply('عدد معتبر بفرست'); w.data.forward=v; w.step=4; return ctx.reply('گام ۴/۵: زمان برگشت (ثانیه) را بفرست.'); }
      if(w.step===4){ const v=parseInt(txt,10); if(!v||v<1) return ctx.reply('عدد معتبر بفرست'); w.data.backward=v; w.step=5; return ctx.reply('گام ۵/۵: برچسب مسیر را بفرست.'); }
      if(w.step===5){
        if(!w.data.label) w.data.label=txt; if(!w.data.emoji) w.data.emoji='🧭';
        const forward={ from_chat_id:w.data.from,to_chat_id:w.data.to,label:`${w.data.label} (→)`,emoji:w.data.emoji,base_travel_sec:parseInt(w.data.forward,10),invite_url:'-',active:true };
        const backward={ from_chat_id:w.data.to,to_chat_id:w.data.from,label:`${w.data.label} (←)`,emoji:w.data.emoji,base_travel_sec:parseInt(w.data.backward,10),invite_url:'-',active:true };
        const { data: f } = await supa.from('gates').insert(forward).select('id').single();
        const { data: b } = await supa.from('gates').insert(backward).select('id').single();
        if(f?.id && b?.id){ await supa.from('gates').update({ inverse_gate_id:b.id }).eq('id', f.id); await supa.from('gates').update({ inverse_gate_id:f.id }).eq('id', b.id); }
        cache.del(`gates:${w.data.from}`); cache.del(`gates:${w.data.to}`);
        await ctx.reply(`✅ مسیر ساخته شد:\n${w.data.from} ↔ ${w.data.to}\nرفت: ${w.data.forward}s | برگشت: ${w.data.backward}s\nبرچسب: ${w.data.label}`);
        return cancelWizard(ctx.from.id);
      }
    }catch(e){ cancelWizard(ctx.from.id); return ctx.reply('❌ خطا در ویزارد. دوباره /linkwiz بزن.'); }
  }

  // Edit inputs (PV)
  const ei = editInputs.get(ctx.from.id);
  if(ei){
    const txt=(ctx.message.text||'').trim(); if(!txt) return;
    if(ei.mode==='setLabel'){
      await supa.from('gates').update({ label: txt }).eq('id', ei.gateId);
      cache.del(`gates:${ei.fromChat}`); await ctx.reply('✅ برچسب بروزرسانی شد'); editInputs.delete(ctx.from.id);
      return sendEditGateCard(ctx, ei.fromChat, ei.gateId);
    }
    if(ei.mode==='setSec'){
      const v=parseInt(txt,10); if(!v||v<1) { await ctx.reply('⛔ عدد معتبر بفرست'); return; }
      await supa.from('gates').update({ base_travel_sec: v }).eq('id', ei.gateId);
      cache.del(`gates:${ei.fromChat}`); await ctx.reply('✅ زمان مسیر بروزرسانی شد'); editInputs.delete(ctx.from.id);
      return sendEditGateCard(ctx, ei.fromChat, ei.gateId);
    }
    if(ei.mode==='autolinkTag'){
      const [tag, ...kindParts]=txt.split(/\s+/); const kind=kindParts.join(' ')||tag;
      await runAutoLinkTag(ei.fromChat, tag, kind);
      await ctx.reply('✅ اتولینک تگی انجام شد');
      editInputs.delete(ctx.from.id); return sendEditHome(ctx.from.id, ei.fromChat);
    }
    if(ei.mode==='autolinkNear'){
      const [radiusStr, kind]=txt.split(/\s+/); const radius=parseFloat(radiusStr||'0'); if(!radius||radius<=0) { await ctx.reply('⛔ فرمت: <radius> <templateKind>'); return; }
      await runAutoLinkNear(ei.fromChat, radius, kind);
      await ctx.reply('✅ اتولینک نزدیک‌ها انجام شد');
      editInputs.delete(ctx.from.id); return sendEditHome(ctx.from.id, ei.fromChat);
    }
    if(ei.mode==='relinkTag'){
      const [tag, ...kindParts]=txt.split(/\s+/); const kind=kindParts.join(' ')||tag;
      await runReLinkTag(ei.fromChat, tag, kind);
      await ctx.reply('✅ ریلینک تگی انجام شد');
      editInputs.delete(ctx.from.id); return sendEditHome(ctx.from.id, ei.fromChat);
    }
    if(ei.mode==='relinkNear'){
      const [radiusStr, kind]=txt.split(/\s+/); const radius=parseFloat(radiusStr||'0'); if(!radius||radius<=0){ await ctx.reply('⛔ فرمت: <radius> <templateKind>'); return; }
      await runReLinkNear(ei.fromChat, radius, kind);
      await ctx.reply('✅ ریلینک نزدیک‌ها انجام شد');
      editInputs.delete(ctx.from.id); return sendEditHome(ctx.from.id, ei.fromChat);
    }
  }
});

// ---------------- Private Editor via /edit ----------------
const editSessions = new Map();  // userId -> { groupId }
const editInputs   = new Map();  // userId -> { mode, fromChat, gateId }

bot.command('edit', async (ctx)=>{
  if(!isOwner(ctx)) return replyNotOwner(ctx);
  const groupId = `${ctx.chat.id}`;
  try{ await bot.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(()=>{}); }catch{}
  editSessions.set(ctx.from.id, { groupId });
  await sendEditHome(ctx.from.id, groupId);
});

async function sendEditHome(userId, groupId){
  let title = groupId;
  try{ const chat=await bot.telegram.getChat(groupId); title = chat.title || groupId; }catch{}
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('📜 لیست مسیرهای این منطقه', `edit:list:${groupId}:1`)],
    [Markup.button.callback('➕ افزودن مسیر (ویزارد)', `edit:add:${groupId}`)],
    [Markup.button.callback('⚙️ اتولینک تگی', `edit:autolink_tag:${groupId}`)],
    [Markup.button.callback('⚙️ اتولینک نزدیک‌ها', `edit:autolink_near:${groupId}`)],
    [Markup.button.callback('🔁 ریلینک تگی (آپدیت زمان‌ها)', `edit:relink_tag:${groupId}`)],
    [Markup.button.callback('🔁 ریلینک نزدیک‌ها (آپدیت زمان‌ها)', `edit:relink_near:${groupId}`)],
    [Markup.button.callback('✅ پایان ویرایش', `edit:done:${groupId}`)]
  ]);
  await bot.telegram.sendMessage(userId, `🛠 در حال ویرایش منطقه: ${title}\nID: ${groupId}`, kb);
}

async function handleEditCallbacks(ctx, data){
  if(ctx.from.id!==OWNER_ID) return ctx.answerCbQuery('دسترسی نداری');
  const parts=data.split(':');
  // edit:list:<fromChat>:<page>
  if(parts[1]==='list'){
    const fromChat=parts[2], page=parseInt(parts[3]||'1',10);
    const pageSize=10;
    const { data: gates } = await supa.from('gates').select('id,to_chat_id,label,base_travel_sec,inverse_gate_id').eq('from_chat_id', fromChat).eq('active', true).order('id',{ascending:true}).limit(400);
    const total=gates?.length||0, pages=Math.max(1, Math.ceil(total/pageSize)), start=(page-1)*pageSize, slice=(gates||[]).slice(start, start+pageSize);
    let txt=`📜 مسیرهای فعال از منطقه ${fromChat} (صفحه ${page}/${pages}):\n`;
    for(const g of slice){ txt+=`• #${g.id} → ${g.to_chat_id} | ${g.label} | ${g.base_travel_sec}s\n`; }
    const nav=[];
    if(page>1) nav.push(Markup.button.callback('◀️ قبلی', `edit:list:${fromChat}:${page-1}`));
    nav.push(Markup.button.callback('🔄 رفرش', `edit:list:${fromChat}:${page}`));
    if(page<pages) nav.push(Markup.button.callback('بعدی ▶️', `edit:list:${fromChat}:${page+1}`));
    const rows = slice.map(g=>[Markup.button.callback(`✏️ #${g.id}`, `edit:gate:${fromChat}:${g.id}`)]);
    rows.push(nav);
    return ctx.editMessageText(txt, Markup.inlineKeyboard(rows));
  }

  // edit:gate:<fromChat>:<gateId>  → کارت ویرایش
  if(parts[1]==='gate'){
    const fromChat=parts[2], gateId=parseInt(parts[3],10);
    return sendEditGateCard(ctx, fromChat, gateId, true);
  }

  // edit:label/sec/del
  if(parts[1]==='setlabel'){
    const fromChat=parts[2], gateId=parseInt(parts[3],10);
    editInputs.set(ctx.from.id, { mode:'setLabel', fromChat, gateId });
    return ctx.reply('📝 برچسب جدید را بفرست (PV).');
  }
  if(parts[1]==='setsec'){
    const fromChat=parts[2], gateId=parseInt(parts[3],10);
    editInputs.set(ctx.from.id, { mode:'setSec', fromChat, gateId });
    return ctx.reply('⏱ تعداد ثانیهٔ جدید را بفرست (PV).');
  }
  if(parts[1]==='del'){
    const fromChat=parts[2], gateId=parseInt(parts[3],10);
    const { data:g } = await supa.from('gates').select('id,inverse_gate_id,from_chat_id,to_chat_id').eq('id', gateId).single();
    if(g){
      await supa.from('gates').delete().eq('id', g.id);
      if(g.inverse_gate_id) await supa.from('gates').delete().eq('id', g.inverse_gate_id);
      cache.del(`gates:${g.from_chat_id}`); cache.del(`gates:${g.to_chat_id}`);
      await ctx.answerCbQuery('حذف شد');
      return sendEditHome(ctx.from.id, fromChat);
    }
    return ctx.answerCbQuery('یافت نشد');
  }

  // افزودن مسیر از ویرایشگر: edit:add:<fromChat>
  if(parts[1]==='add'){
    const fromChat=parts[2];
    linkWizards.set(ctx.from.id, { step:2, data:{ from:fromChat } });
    return ctx.reply('🎯 مبدأ تنظیم شد.\nگام ۲/۵: شناسهٔ گروه "مقصد" را بفرست (PV).');
  }

  // اتولینک/ریلینک با گفت‌وگو
  if(parts[1]==='autolink_tag'){
    const fromChat=parts[2];
    editInputs.set(ctx.from.id, { mode:'autolinkTag', fromChat });
    return ctx.reply('📦 تگ و نام قالب را با فاصله بفرست: \nمثال: بازار شهر↔بازار');
  }
  if(parts[1]==='autolink_near'){
    const fromChat=parts[2];
    editInputs.set(ctx.from.id, { mode:'autolinkNear', fromChat });
    return ctx.reply('📍 شعاع و نام قالب را بفرست: \nمثال: 2.5 شهر↔حومه');
  }
  if(parts[1]==='relink_tag'){
    const fromChat=parts[2];
    editInputs.set(ctx.from.id, { mode:'relinkTag', fromChat });
    return ctx.reply('🔁 تگ و نام قالب را بفرست تا زمان گیت‌های موجود آپدیت شود:\nمثال: بازار شهر↔بازار');
  }
  if(parts[1]==='relink_near'){
    const fromChat=parts[2];
    editInputs.set(ctx.from.id, { mode:'relinkNear', fromChat });
    return ctx.reply('🔁 شعاع و نام قالب را بفرست:\nمثال: 2.5 شهر↔حومه');
  }

  if(parts[1]==='done'){
    const fromChat=parts[2];
    editSessions.delete(ctx.from.id);
    return ctx.editMessageText(`✅ ویرایش ${fromChat} تمام شد.`);
  }

  return ctx.answerCbQuery();
}

async function sendEditGateCard(ctx, fromChat, gateId, replace=false){
  const { data:g } = await supa.from('gates').select('id,to_chat_id,label,base_travel_sec,inverse_gate_id').eq('id', gateId).single();
  if(!g) return ctx.answerCbQuery('یافت نشد');
  const txt=`#${g.id} → ${g.to_chat_id}\nبرچسب: ${g.label}\nزمان: ${g.base_travel_sec}s\n${g.inverse_gate_id?`معکوس: #${g.inverse_gate_id}`:''}`;
  const kb=Markup.inlineKeyboard([
    [Markup.button.callback('✏️ برچسب', `edit:setlabel:${fromChat}:${g.id}`), Markup.button.callback('⏱ زمان', `edit:setsec:${fromChat}:${g.id}`)],
    [Markup.button.callback('🗑 حذف', `edit:del:${fromChat}:${g.id}`)],
    [Markup.button.callback('⬅️ بازگشت', `edit:list:${fromChat}:1`)]
  ]);
  if(replace) return ctx.editMessageText(txt, kb);
  else return bot.telegram.sendMessage(ctx.from.id, txt, kb);
}

// ---------------- AutoLink / ReLink internals ----------------
async function getTemplate(kind){
  const { data:t } = await supa.from('gate_templates').select('*').eq('kind', kind).single();
  return t || null;
}
async function runAutoLinkTag(fromId, tag, kind){
  const t = await getTemplate(kind); if(!t) return;
  const { data: regs } = await supa.from('regions').select('chat_id,tags').limit(2000);
  const targets=(regs||[]).filter(r=>r.chat_id!==fromId && Array.isArray(r.tags)&&r.tags.includes(tag));
  for(let i=0;i<targets.length;i+=100){
    const chunk=targets.slice(i,i+100);
    const forward=chunk.map(r=>({from_chat_id:fromId,to_chat_id:r.chat_id,label:`${t.default_label||kind} (→)`,emoji:t.emoji||'🧭',base_travel_sec:t.forward_sec,invite_url:'-',active:true}));
    const backward=chunk.map(r=>({from_chat_id:r.chat_id,to_chat_id:fromId,label:`${t.default_label||kind} (←)`,emoji:t.emoji||'🧭',base_travel_sec:t.backward_sec,invite_url:'-',active:true}));
    await supa.from('gates').insert(forward); await supa.from('gates').insert(backward); await sleep(200);
  }
  cache.del(`gates:${fromId}`);
}
async function runAutoLinkNear(fromId, radius, kind){
  const t = await getTemplate(kind); if(!t) return;
  const { data: regs } = await supa.from('regions').select('chat_id,x,y').limit(3000);
  const origin=regs.find(r=>`${r.chat_id}`===`${fromId}`);
  if(!origin||origin.x==null||origin.y==null) return;
  const within=(regs||[]).filter(r=>r.chat_id!==fromId && r.x!=null && r.y!=null)
    .filter(r=>Math.hypot(r.x-origin.x,r.y-origin.y)<=radius);
  for(let i=0;i<within.length;i+=100){
    const chunk=within.slice(i,i+100);
    const forward=chunk.map(r=>({from_chat_id:fromId,to_chat_id:r.chat_id,label:`${t.default_label||kind} (→)`,emoji:t.emoji||'🧭',base_travel_sec:t.forward_sec,invite_url:'-',active:true}));
    const backward=chunk.map(r=>({from_chat_id:r.chat_id,to_chat_id:fromId,label:`${t.default_label||kind} (←)`,emoji:t.emoji||'🧭',base_travel_sec:t.backward_sec,invite_url:'-',active:true}));
    await supa.from('gates').insert(forward); await supa.from('gates').insert(backward); await sleep(200);
  }
  cache.del(`gates:${fromId}`);
}
async function runReLinkTag(fromId, tag, kind){
  const t = await getTemplate(kind); if(!t) return;
  const { data: regs } = await supa.from('regions').select('chat_id,tags').limit(2000);
  const targets=(regs||[]).filter(r=>r.chat_id!==fromId && Array.isArray(r.tags)&&r.tags.includes(tag));
  for(const r of targets){
    await supa.from('gates').update({ base_travel_sec:t.forward_sec, label:`${t.default_label||kind} (→)`, emoji:t.emoji||'🧭' })
      .eq('from_chat_id', fromId).eq('to_chat_id', r.chat_id);
    await supa.from('gates').update({ base_travel_sec:t.backward_sec, label:`${t.default_label||kind} (←)`, emoji:t.emoji||'🧭' })
      .eq('from_chat_id', r.chat_id).eq('to_chat_id', fromId);
    await sleep(20);
  }
  cache.del(`gates:${fromId}`);
}
async function runReLinkNear(fromId, radius, kind){
  const t = await getTemplate(kind); if(!t) return;
  const { data: regs } = await supa.from('regions').select('chat_id,x,y').limit(3000);
  const origin=regs.find(r=>`${r.chat_id}`===`${fromId}`); if(!origin||origin.x==null||origin.y==null) return;
  const within=(regs||[]).filter(r=>r.chat_id!==fromId && r.x!=null && r.y!=null)
    .filter(r=>Math.hypot(r.x-origin.x,r.y-origin.y)<=radius);
  for(const r of within){
    await supa.from('gates').update({ base_travel_sec:t.forward_sec, label:`${t.default_label||kind} (→)`, emoji:t.emoji||'🧭' })
      .eq('from_chat_id', fromId).eq('to_chat_id', r.chat_id);
    await supa.from('gates').update({ base_travel_sec:t.backward_sec, label:`${t.default_label||kind} (←)`, emoji:t.emoji||'🧭' })
      .eq('from_chat_id', r.chat_id).eq('to_chat_id', fromId);
    await sleep(20);
  }
  cache.del(`gates:${fromId}`);
}

// ---------------- Owner-Only install guard ----------------
bot.on('my_chat_member', async (ctx)=>{
  try{
    const ns=ctx.update.my_chat_member?.new_chat_member?.status;
    const adderId=ctx.update.my_chat_member?.from?.id; const chatId=ctx.chat?.id;
    if(ns && ['member','administrator'].includes(ns)){
      if(adderId!==OWNER_ID){
        try{ await bot.telegram.sendMessage(chatId, 'این ربات متعلق به مجموعه اکلیس است ، شما حق استفاده از آنها رو ندارین ، حدتو بدون'); }catch{}
        try{ await bot.telegram.leaveChat(chatId); }catch{}
      }
    }
  }catch{}
});

// ---------------- Keep-alive / GC ----------------
function startPing(){ if(!RENDER_URL) return; const url=RENDER_URL, INT=13*60*1000+59*1000; setInterval(async()=>{ try{ await axios.head(`${url}/ping`,{timeout:5000}); }catch{} }, INT); }
app.get('/ping', (_req,res)=>res.status(200).json({ok:true}));

setInterval(async()=>{ const ts=nowIso(); await supa.from('footprints').delete().lt('expires_at', ts); await supa.from('relay_candles').delete().lt('expires_at', ts); }, 180000);

// ---------------- Server / Webhook ----------------
app.use(bot.webhookCallback('/webhook'));
app.get('/', (_req,res)=>res.send('<h3>RPG World Bot</h3>'));

app.listen(PORT, async ()=>{
  console.log('🚀 Bot on port', PORT); startPing();
  try{
    await bot.telegram.deleteWebhook({ drop_pending_updates:true });
    if(RENDER_URL){ const url=`${RENDER_URL}/webhook`; await bot.telegram.setWebhook(url); console.log('✅ Webhook set:', url); }
    else { await bot.launch(); console.log('✅ Long polling launched'); }
  }catch(e){ console.log('Startup warn:', e.message); }
  bootCatchUp().catch(()=>{});
});

process.on('unhandledRejection', (e)=>console.log('Unhandled:', e?.message||e));
