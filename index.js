/**
 * RPG World Bot — PV Menus for #ورود + Delete-on-select + "My ETA" button
 * Persian-safe triggers, Sections (pages), Render/Supabase-friendly
 */
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

const cache = new NodeCache({ stdTTL: 600, checkperiod: 120, maxKeys: 10000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('LOCAL_TIMEOUT')), ms))]);

let ME_ID = null;
(async () => { try { ME_ID = (await bot.telegram.getMe()).id; } catch {} })();

const isOwner = (ctx) => ctx.from?.id === OWNER_ID;
const replyNotOwner = async (ctx) => { try { await ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده', { reply_to_message_id: ctx.message?.message_id }); } catch {} };
const ensureOwner = (ctx) => { if (isOwner(ctx)) return true; replyNotOwner(ctx); return false; };

const normalize = (s='') =>
  s.replace(/\u200c/g, '')      // ZWNJ
   .replace(/[ي]/g, 'ی').replace(/[ك]/g, 'ک')
   .replace(/[ـ]+/g, '')
   .replace(/\s+/g, ' ')
   .trim();

const isTrigger = (text, word) => {
  const t = normalize(text).toLowerCase();
  const r = new RegExp(`^#\\s*${word}(?:\\s|$)`);
  return r.test(t);
};

// ------- admin checks -------
const isBotAdmin = async (chatId) => {
  const key = `admin:${chatId}`;
  const c = cache.get(key);
  if (c !== undefined) return c;
  try {
    const me = await bot.telegram.getChatMember(chatId, ME_ID);
    const ok = ['administrator', 'creator'].includes(me.status);
    cache.set(key, ok, 600);
    return ok;
  } catch { cache.set(key, false, 120); return false; }
};

const ensureAllowedChat = async (chatId) => {
  const k = `allowed:${chatId}`;
  const c = cache.get(k);
  if (c !== undefined) return c;
  try {
    const { data, error } = await withTimeout(
      supa.from('registered_chats').select('chat_id').eq('chat_id', `${chatId}`).maybeSingle(),
      5000
    );
    const ok = !error && !!data;
    cache.set(k, ok, 600);
    return ok;
  } catch { cache.set(k, false, 120); return false; }
};

const getRegionState = async (chatId) => {
  const k = `region:${chatId}`;
  const c = cache.get(k);
  if (c) return c;
  const { data } = await supa.from('registered_chats').select('locked, locked_message').eq('chat_id', `${chatId}`).maybeSingle();
  const st = { locked: !!data?.locked, msg: data?.locked_message || 'این منطقه فعلاً بسته است.' };
  cache.set(k, st, 300); return st;
};

const getChatTitle = async (chatId) => {
  const k = `title:${chatId}`;
  const c = cache.get(k);
  if (c !== undefined) return c;
  const { data } = await supa.from('registered_chats').select('title').eq('chat_id', `${chatId}`).maybeSingle();
  const t = data?.title || `${chatId}`;
  cache.set(k, t, 3600);
  return t;
};

// ------- rate-limited sender -------
const globalQueue = []; let sending = false;
const SEND_RATE_DELAY = 70;
async function enqueueSend(fn){ return new Promise((resolve)=>{ globalQueue.push({fn,resolve}); if(!sending) pump(); }); }
async function pump(){ sending = true; while(globalQueue.length){ const {fn,resolve}=globalQueue.shift(); try{ resolve(await fn()); }catch(e){ resolve(Promise.reject(e)); } await sleep(SEND_RATE_DELAY); } sending=false; }
async function safeSendMessage(chatId, text, extra = {}) {
  try { return await enqueueSend(() => bot.telegram.sendMessage(chatId, text, extra)); }
  catch (e) {
    const m = String(e.message || e);
    if (/429|timeout|ETELEGRAM/i.test(m)) {
      await sleep(600);
      try { return await enqueueSend(() => bot.telegram.sendMessage(chatId, text, extra)); } catch {}
    }
    throw e;
  }
}

// ------- DB helpers -------
async function getGatesFrom(fromChatId) {
  const k = `gates:${fromChatId}`;
  const c = cache.get(k);
  if (c) return c;
  const { data } = await withTimeout(
    supa.from('gates').select('id, from_chat_id, to_chat_id, label, emoji, base_travel_sec, active, section, order_index')
      .eq('from_chat_id', `${fromChatId}`)
      .order('section', { ascending: true })
      .order('order_index', { ascending: true })
      .order('id', { ascending: true })
      .limit(500),
    6000
  );
  // فعال = هر چیزی جز false
  const filtered = (data || []).filter(g => g.active !== false);
  cache.set(k, filtered, 600);
  return filtered;
}
async function upsertPlayer(p){ await supa.from('players').upsert(p, { onConflict: 'user_id' }); }
async function upsertMovement(m){ await supa.from('movements').upsert(m, { onConflict: 'move_id' }); }
function newMoveId(userId, gateId){ return `${userId}_${gateId}_${Date.now()}`; }

async function createOneTimeInvite(destChatId, userId, gateId, ttlSec) {
  const expireAt = Math.floor(Date.now()/1000) + Math.max(60, Math.min(ttlSec, 600));
  return await bot.telegram.createChatInviteLink(destChatId, {
    expire_date: expireAt, member_limit: 1, creates_join_request: true, name: `ticket-${userId}-${gateId}`
  });
}

async function listSections(fromChatId){
  const gates = await getGatesFrom(fromChatId);
  const map = new Map();
  for (const g of gates) {
    const s = (g.section || 'اصلی').slice(0, 40);
    map.set(s, (map.get(s)||0)+1);
  }
  return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0], 'fa'));
}

async function fetchLockMap(chatIds){
  if (!chatIds.length) return {};
  const { data } = await supa.from('registered_chats').select('chat_id, locked').in('chat_id', chatIds.map(String));
  const map={}; for(const r of (data||[])) map[`${r.chat_id}`]=!!r.locked; return map;
}

function humanizeSeconds(sec){ sec=Math.max(1,Math.round(sec)); if(sec<60) return `${sec} ثانیه`; const m=Math.floor(sec/60), s=sec%60; return s?`${m} دقیقه و ${s} ثانیه`:`${m} دقیقه`; }

// ------- PV MENUS -------
async function buildSectionMenuPV(fromChatId){
  const secs = await listSections(fromChatId);
  const rows = secs.map(([name,count]) => [Markup.button.callback(`📂 ${name} (${count})`, `pmenu:sec:${fromChatId}:${encodeURIComponent(name)}`)]);
  rows.push([Markup.button.callback('⏳ زمانِ باقی‌ماندهٔ من', 'pmenu:eta')]);
  return {
    text: `مبدأ: ${await getChatTitle(fromChatId)}\nبخش مورد نظر را انتخاب کن:`,
    kb: Markup.inlineKeyboard(rows.length ? rows : [[Markup.button.callback('بخشی ثبت نشده', 'wz:nop')]], { columns: 1 })
  };
}

async function buildGatesMenuPV(fromChatId, sectionName){
  const gates = (await getGatesFrom(fromChatId)).filter(g => (g.section || 'اصلی') === sectionName);
  const toIds = gates.map(g => `${g.to_chat_id}`); const lockMap = await fetchLockMap([...new Set(toIds)]);
  const rows = [];
  for (const g of gates.slice(0, 24)) {
    const locked = !!lockMap[`${g.to_chat_id}`];
    const labelText = `${locked ? '⛔️ ' : ''}${g.emoji || '🧭'} ${g.label} — ${humanizeSeconds(g.base_travel_sec)}`;
    // علامت 'pm' برای تشخیص PV (صرفاً تزئینی؛ gateId کافی‌ست)
    rows.push([Markup.button.callback(labelText, `ticket:gate:${g.id}:${g.base_travel_sec}:pm`)]);
  }
  rows.push([Markup.button.callback('⬅️ صفحات', `pmenu:sections:${fromChatId}`)]);
  rows.push([Markup.button.callback('⏳ زمانِ باقی‌ماندهٔ من', 'pmenu:eta')]);
  return {
    text: `مبدأ: ${await getChatTitle(fromChatId)}\nبخش «${sectionName}» — مسیرها:`,
    kb: Markup.inlineKeyboard(rows, { columns: 1 })
  };
}

async function sendMenuToPV(fromChatId, userId){
  try {
    await bot.telegram.sendChatAction(userId, 'typing');
  } catch {
    return false; // PV بسته است
  }
  const secs = await listSections(fromChatId);
  if (secs.length > 1) {
    const { text, kb } = await buildSectionMenuPV(fromChatId);
    await safeSendMessage(userId, text, kb);
  } else {
    const sectionName = secs[0]?.[0] || 'اصلی';
    const { text, kb } = await buildGatesMenuPV(fromChatId, sectionName);
    await safeSendMessage(userId, text, kb);
  }
  return true;
}

// ------- group-clean quarantine -------
async function softKickFromChat(chatId, userId) {
  try {
    if (!await isBotAdmin(chatId)) return false;
    try {
      const m = await bot.telegram.getChatMember(chatId, userId);
      if (['left','kicked','creator'].includes(m.status)) return true;
    } catch {}
    await bot.telegram.banChatMember(chatId, userId);
    setTimeout(()=>bot.telegram.unbanChatMember(chatId, userId).catch(()=>{}), 10_000);
    await sleep(80);
    return true;
  } catch { return false; }
}
async function removeFromOtherChats(allowedChatId, userId){
  const k = 'registered:list';
  let regs = cache.get(k);
  if (!regs) { const { data } = await supa.from('registered_chats').select('chat_id').limit(5000); regs = data||[]; cache.set(k, regs, 600); }
  for (const r of regs) {
    const cid = `${r.chat_id}`; if (cid === `${allowedChatId}`) continue;
    await softKickFromChat(cid, userId);
  }
}

// ------- movement scheduling -------
const scheduledJobs = new Map();
async function scheduleArrival(move){
  const delay = Math.max(0, new Date(move.arrive_at).getTime() - Date.now());
  if (delay > 60*60*1000) return;
  if (scheduledJobs.has(move.move_id)) return;
  const tid = setTimeout(async ()=>{
    scheduledJobs.delete(move.move_id);
    try{
      const { data:m } = await supa.from('movements').select('state,to_chat_id,user_id').eq('move_id', move.move_id).maybeSingle();
      if (!m || m.state!=='scheduled') return;
      // رسیدن: پیام گیت‌های مقصد را در گروه مقصد بفرستیم (مثل قبل)
      const gates = await getGatesFrom(m.to_chat_id);
      if (!gates || !gates.length) {
        await safeSendMessage(m.to_chat_id, '🔍 برای این منطقه هنوز مسیری تعریف نشده. از /link_wizard در PV استفاده کن.');
      } else {
        // برخلاف #ورود، این یکی را همچنان در مقصد گروه نشان می‌دهیم
        const secs = await listSections(m.to_chat_id);
        if (secs.length > 1) {
          const rows = secs.map(([name,count]) => [Markup.button.callback(`📂 ${name} (${count})`, `menu:sec:${encodeURIComponent(name)}`)]);
          await safeSendMessage(m.to_chat_id, '🎴┊وارد شدی؛ مسیرت را انتخاب کن:', Markup.inlineKeyboard(rows, { columns: 1 }));
        } else {
          const sectionName = secs[0]?.[0] || 'اصلی';
          const destGates = (await getGatesFrom(m.to_chat_id)).filter(g => (g.section||'اصلی')===sectionName);
          const toIds = destGates.map(g => `${g.to_chat_id}`);
          const lockMap = await fetchLockMap([...new Set(toIds)]);
          const rows = [];
          for (const g of destGates.slice(0,24)) {
            const locked = !!lockMap[`${g.to_chat_id}`];
            const labelText = `${locked ? '⛔️ ' : ''}${g.emoji || '🧭'} ${g.label} — ${humanizeSeconds(g.base_travel_sec)}`;
            rows.push([Markup.button.callback(labelText, `ticket:gate:${g.id}:${g.base_travel_sec}`)]);
          }
          await safeSendMessage(m.to_chat_id, '🎴┊وارد شدی؛ هوای اینجا بوی ماجرا می‌دهد...', Markup.inlineKeyboard(rows, { columns:1 }));
        }
      }
      await supa.from('players').update({ status:'idle', updated_at: nowIso() }).eq('user_id', m.user_id);
      await supa.from('movements').update({ state:'arrived' }).eq('move_id', move.move_id);
    }catch{}
  }, delay);
  scheduledJobs.set(move.move_id, tid);
}
async function bootCatchUp(){
  const from = new Date(Date.now()-120_000).toISOString();
  const to = new Date(Date.now()+120_000).toISOString();
  const { data } = await supa.from('movements').select('move_id,user_id,to_chat_id,arrive_at,state')
    .eq('state','scheduled').gte('arrive_at',from).lte('arrive_at',to).limit(500);
  for (const m of (data||[])) scheduleArrival(m);
}

// ------- handlers -------
bot.on('callback_query', async (ctx) => {
  try{
    const cb = ctx.callbackQuery;
    const data = cb.data || '';
    const chatType = ctx.chat?.type;
    const chatId = ctx.chat?.id;
    const userId = cb.from?.id;

    if (data === 'wz:nop') return ctx.answerCbQuery();

    // ===== PV Menu navigation =====
    if (data.startsWith('pmenu:sections:')) {
      const fromChatId = data.split(':')[2];
      const { text, kb } = await buildSectionMenuPV(fromChatId);
      try { await ctx.editMessageText(text, kb); } catch { await safeSendMessage(userId, text, kb); }
      return ctx.answerCbQuery();
    }
    if (data.startsWith('pmenu:sec:')) {
      const parts = data.split(':'); // pmenu, sec, fromChatId, encodedName...
      const fromChatId = parts[2];
      const secName = decodeURIComponent(parts.slice(3).join(':'));
      const { text, kb } = await buildGatesMenuPV(fromChatId, secName);
      try { await ctx.editMessageText(text, kb); } catch { await safeSendMessage(userId, text, kb); }
      return ctx.answerCbQuery();
    }
    if (data === 'pmenu:eta') {
      // آخرین حرکت زمان‌بندی‌شده کاربر
      const { data: mv } = await supa.from('movements').select('arrive_at,state,to_chat_id').eq('user_id', userId).eq('state','scheduled')
        .order('departed_at', { ascending: false }).limit(1);
      const m = mv && mv[0];
      if (!m) return ctx.answerCbQuery('در حال حاضر حرکتی در جریان نیست');
      const etaMs = new Date(m.arrive_at).getTime() - Date.now();
      if (etaMs <= 0) return ctx.answerCbQuery('به مقصد رسیده‌ای (یا تا چند ثانیهٔ دیگر می‌رسی)');
      return ctx.answerCbQuery(`زمانِ باقی‌مانده: ${humanizeSeconds(Math.round(etaMs/1000))}`);
    }

    // ===== Section navigation in groups (arrival menus) =====
    if (data === 'menu:sections') {
      const gatesChatId = chatId;
      const secs = await listSections(gatesChatId);
      const rows = secs.map(([name,count]) => [Markup.button.callback(`📂 ${name} (${count})`, `menu:sec:${encodeURIComponent(name)}`)]);
      try { await ctx.editMessageText('بخش را انتخاب کن:', Markup.inlineKeyboard(rows, { columns: 1 })); } catch {}
      return ctx.answerCbQuery();
    }
    if (data.startsWith('menu:sec:')) {
      const secName = decodeURIComponent(data.split(':').slice(2).join(':'));
      const gates = (await getGatesFrom(chatId)).filter(g => (g.section || 'اصلی') === secName);
      const toIds = gates.map(g => `${g.to_chat_id}`); const lockMap = await fetchLockMap([...new Set(toIds)]);
      const rows = [];
      for (const g of gates.slice(0, 24)) {
        const locked = !!lockMap[`${g.to_chat_id}`];
        const labelText = `${locked ? '⛔️ ' : ''}${g.emoji || '🧭'} ${g.label} — ${humanizeSeconds(g.base_travel_sec)}`;
        rows.push([Markup.button.callback(labelText, `ticket:gate:${g.id}:${g.base_travel_sec}`)]);
      }
      rows.push([Markup.button.callback('⬅️ صفحات', 'menu:sections')]);
      try { await ctx.editMessageText(`مسیرهای بخش «${secName}»:`, Markup.inlineKeyboard(rows, { columns:1 })); } catch {}
      return ctx.answerCbQuery();
    }

    // ===== Tickets (works in PV or groups) =====
    if (data.startsWith('ticket:gate:')) {
      const parts = data.split(':'); // ticket, gate, <id>, <sec>, [pm]
      const gateId = parts[2];                 // string-safe (UUID یا عدد)
      const etaSec = parseInt(parts[3], 10);

      // از دیتابیس بخوان
      const { data: g } = await supa.from('gates').select('id,from_chat_id,to_chat_id,base_travel_sec').eq('id', gateId).maybeSingle();
      if (!g) { await ctx.answerCbQuery('مسیر نامعتبر'); return; }

      const destState = await getRegionState(`${g.to_chat_id}`);
      if (destState.locked) { await ctx.answerCbQuery(destState.msg || '⛔️ منطقه بسته است'); return; }

      const link = await createOneTimeInvite(g.to_chat_id, userId, gateId, 5*60);
      const moveId = newMoveId(userId, gateId);
      const depart = nowIso();
      const arrive = new Date(Date.now() + (etaSec*1000)).toISOString();

      await upsertPlayer({ user_id:userId, current_chat_id:`${g.to_chat_id}`, last_chat_id:`${g.from_chat_id}`, status:'quarantined', updated_at:depart });
      await upsertMovement({ move_id:moveId, user_id:userId, from_chat_id:`${g.from_chat_id}`, to_chat_id:`${g.to_chat_id}`,
        gate_id:gateId, departed_at:depart, arrive_at:arrive, state:'scheduled',
        ticket_id:moveId, ticket_expires_at:new Date(Date.now()+5*60*1000).toISOString(), invite_link: link.invite_link
      });

      removeFromOtherChats(`${g.to_chat_id}`, userId).catch(()=>{});
      scheduleArrival({ move_id:moveId, arrive_at:arrive, to_chat_id:g.to_chat_id, user_id:userId });

      try {
        await bot.telegram.sendMessage(userId, `🎟️ بلیت مقصد آماده شد.\n\nبرای ورود کلیک کن:`,
          Markup.inlineKeyboard([[Markup.button.url('ورود به مقصد', link.invite_link)]])
        );
        await ctx.answerCbQuery('لینک در PV ارسال شد');
      } catch {
        await ctx.answerCbQuery('PV بات را استارت کن');
      }

      // اگر در PV روی دکمه زده، همون منوی PV را پاک کن
      if (chatType === 'private') {
        try { await ctx.deleteMessage(); } catch {}
      }
      return;
    }

    await ctx.answerCbQuery();
  }catch{ try{ await ctx.answerCbQuery('خطا'); }catch{} }
});

bot.on('chat_join_request', async (ctx) => {
  try{
    const req = ctx.update.chat_join_request;
    const userId = req.from.id;
    const chatId = `${req.chat.id}`;
    const usedLink = req.invite_link?.invite_link || '';

    const destState = await getRegionState(chatId);
    if (destState.locked) { await ctx.declineChatJoinRequest(userId); return; }

    const { data } = await supa.from('movements').select('move_id,state,to_chat_id,user_id,ticket_expires_at,invite_link')
      .eq('user_id', userId).eq('to_chat_id', chatId).eq('state','scheduled')
      .order('departed_at',{ascending:false}).limit(1);
    const mv = (data && data[0]) || null;
    if (!mv) { await ctx.declineChatJoinRequest(userId); return; }

    const notExpired = new Date(mv.ticket_expires_at) > new Date();
    const linkMatch = mv.invite_link === usedLink;

    if (notExpired && linkMatch) {
      await ctx.approveChatJoinRequest(userId);
      await supa.from('players').upsert({ user_id:userId, current_chat_id:chatId, status:'quarantined', updated_at: nowIso() }, { onConflict:'user_id' });
    } else {
      await ctx.declineChatJoinRequest(userId);
    }
  }catch{}
});

// ------- group text triggers -------
async function handleVorud(ctx){
  const chatId = `${ctx.chat?.id}`; const userId = ctx.from?.id;
  if (!chatId || !userId) return;
  const allowed = await ensureAllowedChat(chatId);
  if (!allowed) { await ctx.reply('⚠️ این منطقه هنوز فعال نشده. داخل همین گروه با اکانت مالک بزن: /on'); return; }

  try {
    // DM منو به PV کاربر
    const ok = await sendMenuToPV(chatId, userId);
    if (!ok) {
      await ctx.reply('برای دریافت فهرست مسیرها، لطفاً PV بات را /start کن.');
      return;
    }
    await ctx.reply('✅ فهرست مسیرها به PV شما ارسال شد.');
  } catch {
    try { await ctx.reply('یک خطای موقت رخ داد. دوباره #ورود بزن یا کمی بعد تلاش کن.'); } catch {}
  }
}
async function handleKhoroj(ctx){
  const user = ctx.message?.from; if (!user || user.is_bot) return;
  try { await ctx.reply(`🧭┊سفر به سلامت ${user.first_name || ''}`, { reply_to_message_id: ctx.message.message_id }); } catch {}
}

bot.on('text', async (ctx, next) => {
  if (ctx.chat?.type === 'private') return next();
  const t = ctx.message?.text || '';
  if (isTrigger(t, 'ورود')) return handleVorud(ctx);
  if (isTrigger(t, 'خروج')) return handleKhoroj(ctx);
  return next();
});

// Commands
bot.start((ctx) => ctx.reply('نینجا در خدمت شماست 🥷🏻'));

bot.command('on', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`, title = ctx.chat.title || 'بدون عنوان';
  const { error } = await supa.from('registered_chats').upsert({ chat_id: chatId, title, created_at: nowIso() }, { onConflict:'chat_id' });
  cache.del(`allowed:${chatId}`); cache.del('registered:list'); cache.del(`region:${chatId}`); cache.del(`title:${chatId}`);
  if (error) return ctx.reply('❌ خطا در ثبت منطقه'); ctx.reply('✅ منطقه ثبت شد');
});

bot.command('off', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`;
  await supa.from('registered_chats').delete().eq('chat_id', chatId);
  cache.del(`allowed:${chatId}`); cache.del('registered:list'); cache.del(`region:${chatId}`); cache.del(`title:${chatId}`);
  await ctx.reply('✅ منطقه حذف شد؛ ربات لفت می‌دهد…'); try{ await ctx.leaveChat(); }catch{}
});

// lock/unlock
bot.command('lock', async (ctx) => { if(!ensureOwner(ctx))return; const id = `${ctx.chat.id}`; await supa.from('registered_chats').update({locked:true}).eq('chat_id', id); cache.del(`region:${id}`); ctx.reply('⛔️ این منطقه قفل شد'); });
bot.command('unlock', async (ctx) => { if(!ensureOwner(ctx))return; const id = `${ctx.chat.id}`; await supa.from('registered_chats').update({locked:false}).eq('chat_id', id); cache.del(`region:${id}`); ctx.reply('✅ این منطقه باز شد'); });
bot.command('toggle_lock', async (ctx) => {
  if(!ensureOwner(ctx))return; const id = `${ctx.chat.id}`; const st = await getRegionState(id);
  await supa.from('registered_chats').update({ locked: !st.locked }).eq('chat_id', id);
  cache.del(`region:${id}`); ctx.reply(!st.locked ? '⛔️ قفل شد' : '✅ باز شد');
});

// VIP / FREE
bot.command('vip', async (ctx) => { if(!ensureOwner(ctx))return;
  const t = ctx.message?.reply_to_message?.from; if(!t) return ctx.reply('روی پیام کاربر ریپلای کن بعد /vip بزن');
  await supa.from('vip_users').upsert({ user_id:t.id, added_at:nowIso() }, { onConflict:'user_id' });
  await supa.from('players').delete().eq('user_id', t.id); ctx.reply(`✅ ${t.first_name} VIP شد`);
});
bot.command('unvip', async (ctx) => { if(!ensureOwner(ctx))return;
  const t = ctx.message?.reply_to_message?.from; if(!t) return ctx.reply('روی پیام کاربر ریپلای کن بعد /unvip بزن');
  await supa.from('vip_users').delete().eq('user_id', t.id); ctx.reply(`✅ ${t.first_name} از VIP خارج شد`);
});
bot.command('free', async (ctx) => { if(!ensureOwner(ctx))return;
  const t = ctx.message?.reply_to_message?.from; if(!t) return ctx.reply('روی پیام کاربر ریپلای کن بعد /free بزن');
  await supa.from('players').delete().eq('user_id', t.id); ctx.reply(`✅ ${t.first_name} از قرنطینه خارج شد`);
});

// لیست مسیرها + حذف دوطرفه
bot.command('listgates', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const fromId = `${ctx.chat.id}`;
  const { data, error } = await supa.from('gates').select('id,to_chat_id,label,base_travel_sec,inverse_gate_id,section,order_index,active')
    .eq('from_chat_id', fromId)
    .order('section',{ascending:true}).order('order_index',{ascending:true}).order('id',{ascending:true}).limit(500);
  if (error) return ctx.reply('❌ خطا');
  const rows = (data || []).filter(g=>g.active!==false);
  if (!rows.length) return ctx.reply('هیچ مسیری ثبت نیست');
  let out = 'گیت‌های فعال از این منطقه:\n';
  for (const g of rows) {
    out += `• [${g.section||'اصلی'}] #${g.id} → ${g.to_chat_id} | ${g.label} | ${g.base_travel_sec}s`;
    if (g.inverse_gate_id) out += ` (↔ ${g.inverse_gate_id})`;
    out += '\n';
  }
  ctx.reply(out);
});
bot.command('unlink', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const parts = (ctx.message.text || '').trim().split(/\s+/);
  if (parts.length < 3) return ctx.reply('فرمت: /unlink <from_chat_id> <to_chat_id>');
  const [, fromId, toId] = parts;
  await supa.from('gates').delete().eq('from_chat_id', fromId).eq('to_chat_id', toId);
  await supa.from('gates').delete().eq('from_chat_id', toId).eq('to_chat_id', fromId);
  cache.del(`gates:${fromId}`); cache.del(`gates:${toId}`); ctx.reply('✅ لینک‌های رفت/برگشت حذف شد');
});

// فقط مالک می‌تونه اضافه کنه
bot.on('my_chat_member', async (ctx) => {
  try{
    const ns = ctx.update.my_chat_member?.new_chat_member?.status;
    const adderId = ctx.update.my_chat_member?.from?.id;
    const chatId = ctx.chat?.id;
    if (ns && ['member','administrator'].includes(ns)) {
      if (adderId !== OWNER_ID) {
        try{ await bot.telegram.sendMessage(chatId, 'این ربات متعلق به مجموعه اکلیس است ، شما حق استفاده از آنها رو ندارین ، حدتو بدون'); }catch{}
        try{ await bot.telegram.leaveChat(chatId); }catch{}
      }
    }
  }catch{}
});

// ------- keepalive & webhook -------
function startPing(){ if(!RENDER_URL) return; const url=RENDER_URL; const t=13*60*1000+59*1000; setInterval(()=>axios.head(`${url}/ping`).catch(()=>{}), t); }
app.get('/ping', (_req,res)=>res.status(200).json({ok:true}));

setInterval(async ()=>{
  const ts = nowIso();
  await supa.from('footprints').delete().lt('expires_at', ts).catch(()=>{});
  await supa.from('relay_candles').delete().lt('expires_at', ts).catch(()=>{});
}, 180_000);

app.use(bot.webhookCallback('/webhook'));
app.get('/', (_req, res) => res.send('<h3>RPG World Bot</h3>'));

app.listen(PORT, async () => {
  console.log('🚀 Bot on port', PORT);
  startPing();
  try{
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    if (RENDER_URL) { const url = `${RENDER_URL}/webhook`; await bot.telegram.setWebhook(url); console.log('✅ Webhook set:', url); }
    else { await bot.launch(); console.log('✅ Long polling launched'); }
  } catch (e) { console.log('Startup warn:', e.message); }
  bootCatchUp().catch(()=>{});
});

process.on('unhandledRejection', (e)=>console.log('Unhandled:', e?.message || e));
