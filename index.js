/**
 * RPG World Bot — Robust gates + Sections (Pages) + PV Wizard
 * Fix: gateId as string (UUID-safe), sectioned menus, Persian #ورود matcher
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
   .replace(/[ي]/g, 'ی').replace(/[ك]/g, 'ک') // عربی→فارسی
   .replace(/[ـ]+/g, '')        // کشیده
   .replace(/\s+/g, ' ')        // فاصله‌ها
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
      .eq('from_chat_id', `${fromChatId}`).eq('active', true)
      .order('order_index', { ascending: true })
      .order('id', { ascending: true })
      .limit(500),
    6000
  );
  cache.set(k, data || [], 600);
  return data || [];
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
  // مرتب‌سازی بخش‌ها بر اساس نام
  return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0], 'fa'));
}

async function fetchLockMap(chatIds){
  if (!chatIds.length) return {};
  const { data } = await supa.from('registered_chats').select('chat_id, locked').in('chat_id', chatIds.map(String));
  const map={}; for(const r of (data||[])) map[`${r.chat_id}`]=!!r.locked; return map;
}

function humanizeSeconds(sec){ sec=Math.max(1,Math.round(sec)); if(sec<60) return `${sec} ثانیه`; const m=Math.floor(sec/60), s=sec%60; return s?`${m} دقیقه و ${s} ثانیه`:`${m} دقیقه`; }

// ------- building menus -------
async function buildSectionMenu(chatId){
  const secs = await listSections(chatId);
  const rows = secs.map(([name,count]) => [Markup.button.callback(`📂 ${name} (${count})`, `menu:sec:${encodeURIComponent(name)}`)]);
  return {
    text: 'بخش مورد نظر را انتخاب کن:',
    kb: Markup.inlineKeyboard(rows.length ? rows : [[Markup.button.callback('بخشی ثبت نشده', 'wz:nop')]], { columns: 1 })
  };
}

async function buildGatesMenu(chatId, sectionName){
  const gates = (await getGatesFrom(chatId)).filter(g => (g.section || 'اصلی') === sectionName);
  const toIds = gates.map(g => `${g.to_chat_id}`); const lockMap = await fetchLockMap([...new Set(toIds)]);
  const rows = [];
  for (const g of gates.slice(0, 24)) {
    const locked = !!lockMap[`${g.to_chat_id}`];
    const labelText = `${locked ? '⛔️ ' : ''}${g.emoji || '🧭'} ${g.label} — ${humanizeSeconds(g.base_travel_sec)}`;
    rows.push([Markup.button.callback(labelText, `ticket:gate:${g.id}:${g.base_travel_sec}`)]);
  }
  rows.push([Markup.button.callback('⬅️ صفحات', 'menu:sections')]);
  return {
    text: `مسیرهای بخش «${sectionName}»:`,
    kb: Markup.inlineKeyboard(rows, { columns: 1 })
  };
}

async function sendArrivalMessage(destChatId, userId){
  const gates = await getGatesFrom(destChatId);
  if (!gates || !gates.length) {
    await safeSendMessage(destChatId, '🔍 برای این منطقه هنوز مسیری تعریف نشده. از /link_wizard در PV استفاده کن.');
    return;
  }
  const secs = await listSections(destChatId);
  if (secs.length > 1) {
    const { text, kb } = await buildSectionMenu(destChatId);
    await safeSendMessage(destChatId, text, kb);
  } else {
    const sectionName = secs[0]?.[0] || 'اصلی';
    const { text, kb } = await buildGatesMenu(destChatId, sectionName);
    await safeSendMessage(destChatId, text, kb);
  }
}

// ------- quarantine helpers -------
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
      await sendArrivalMessage(m.to_chat_id, m.user_id);
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
    const chatId = ctx.chat?.id;
    const userId = cb.from?.id;

    if (data === 'wz:nop') return ctx.answerCbQuery();

    // section navigation
    if (data === 'menu:sections') {
      const { text, kb } = await buildSectionMenu(chatId);
      try { await ctx.editMessageText(text, kb); } catch { await safeSendMessage(chatId, text, kb); }
      return ctx.answerCbQuery();
    }
    if (data.startsWith('menu:sec:')) {
      const secName = decodeURIComponent(data.split(':').slice(2).join(':'));
      const { text, kb } = await buildGatesMenu(chatId, secName);
      try { await ctx.editMessageText(text, kb); } catch { await safeSendMessage(chatId, text, kb); }
      return ctx.answerCbQuery();
    }

    // Wizard only in PV
    if (data.startsWith('wz:') && ctx.chat?.type !== 'private') {
      await ctx.answerCbQuery('ویزارد فقط در PV کار می‌کند'); return;
    }
    if (data.startsWith('wz:')) return handleWizardAction(ctx);

    // Ticket: use string gateId (UUID-safe)
    if (data.startsWith('ticket:gate:')) {
      if (!await ensureAllowedChat(chatId)) {
        await ctx.answerCbQuery('منطقه فعال نیست'); 
        try { await safeSendMessage(chatId, '⚠️ این منطقه فعال نیست. با /on فعال کن.'); } catch {}
        return;
      }
      const parts = data.split(':'); // ticket, gate, <id>, <sec>
      const gateId = parts[2];                 // ← بدون parseInt
      const etaSec = parseInt(parts[3], 10);

      const { data: g } = await supa.from('gates').select('id,from_chat_id,to_chat_id,base_travel_sec')
        .eq('id', gateId).maybeSingle();
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

      try{
        await bot.telegram.sendMessage(userId, `🎟️ بلیت مقصد آماده شد.\n\nبرای ورود کلیک کن:`,
          Markup.inlineKeyboard([[Markup.button.url('ورود به مقصد', link.invite_link)]])
        );
        await ctx.answerCbQuery('لینک در PV ارسال شد');
      } catch {
        await ctx.answerCbQuery('PV بات را استارت کن');
        await safeSendMessage(chatId, `[${cb.from.first_name}](tg://user?id=${userId})\nبرای دریافت لینک، PV بات را استارت کن`, { parse_mode:'Markdown' });
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

// متن‌های ساده در گروه
async function handleVorud(ctx){
  const chatId = `${ctx.chat?.id}`; const userId = ctx.from?.id;
  if (!chatId || !userId) return;
  const allowed = await ensureAllowedChat(chatId);
  if (!allowed) { await ctx.reply('⚠️ این منطقه هنوز فعال نشده. داخل همین گروه با اکانت مالک بزن: /on'); return; }

  try {
    const now = new Date();
    const { data } = await supa.from('movements')
      .select('arrive_at, state').eq('user_id', userId).eq('to_chat_id', chatId)
      .eq('state','scheduled').order('arrive_at', { ascending: false }).limit(1);
    const mv = (data && data[0]) || null;
    if (mv) {
      const etaMs = new Date(mv.arrive_at).getTime() - now.getTime();
      if (etaMs > 0) {
        const sec = Math.max(1, Math.round(etaMs/1000));
        await ctx.reply(`⏳ هنوز در مسیر هستی — ${humanizeSeconds(sec)} تا رسیدن باقیست.`);
        return;
      }
    }

    const gates = await getGatesFrom(chatId);
    if (!gates || !gates.length) { await ctx.reply('🔍 مسیر تعریف نشده.\nاز PV با /link_wizard بخش و مسیر بساز.'); return; }
    await sendArrivalMessage(chatId, userId);
  } catch { try { await ctx.reply('خطای موقت. دوباره #ورود بزن.'); } catch {} }
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
  const { data, error } = await supa.from('gates').select('id,to_chat_id,label,base_travel_sec,inverse_gate_id,section,order_index')
    .eq('from_chat_id', fromId).eq('active', true)
    .order('section',{ascending:true}).order('order_index',{ascending:true}).order('id',{ascending:true}).limit(500);
  if (error) return ctx.reply('❌ خطا');
  if (!data || !data.length) return ctx.reply('هیچ مسیری ثبت نیست');
  let out = 'گیت‌های فعال از این منطقه:\n';
  for (const g of data) {
    out += `• [${g.section}] #${g.id} → ${g.to_chat_id} | ${g.label} | ${g.base_travel_sec}s`;
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

// Ownership-safe join
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

// ---------------- PV WIZARD (با «بخش») ----------------
const wizard = new Map(); // userId -> state
function wzState(uid){ if(!wizard.has(uid)) wizard.set(uid,{ step:0 }); return wizard.get(uid); }

async function ensurePV(userId){
  try { await bot.telegram.sendChatAction(userId, 'typing'); return true; }
  catch { return false; }
}

async function startWizardInPV(userId, lastGroupId){
  const ok = await ensurePV(userId);
  if (!ok) return false;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('✔️ مبدأ = آخرین گروهی که ویزارد را صدا زدم', 'wz:from:this')],
    [Markup.button.callback('📜 انتخاب مبدأ از لیست', 'wz:from:list:1')],
    [Markup.button.callback('🔎 جستجوی مبدأ با آیدی', 'wz:from:find')],
    [Markup.button.callback('❌ لغو', 'wz:cancel')]
  ]);
  await safeSendMessage(userId, 'وِیزارد لینک: مبدأ را انتخاب کن.', kb);
  const st = wzState(userId); st.lastGroupId = lastGroupId || null; st.step = 1;
  return true;
}

bot.command('link_wizard', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const uid = ctx.from.id;
  const started = await startWizardInPV(uid, ctx.chat?.type !== 'private' ? `${ctx.chat.id}` : null);
  if (!started) return ctx.reply('برای ادامه، PV بات را /start کن تا ویزارد را آنجا اجرا کنم.');
  if (ctx.chat?.type !== 'private') { try { await ctx.reply('✔️ ادامهٔ ویزارد در PV شما انجام می‌شود.'); } catch {} }
});

// پیام‌های متنیِ ویزارد فقط در PV
bot.on('text', async (ctx, next) => {
  if (ctx.chat?.type !== 'private') return next();
  if (!isOwner(ctx)) return next();
  const uid = ctx.from.id;
  const st = wizard.get(uid); if (!st) return next();

  // ورودی آیدی برای جستجوی سریع
  if (st.step === 'fromIdInput' || st.step === 'toIdInput') {
    const raw = (ctx.message.text || '').trim();
    if (!/^-?\d{6,20}$/.test(raw)) return safeSendMessage(uid, '⛔️ آیدی عددی نامعتبر است. دوباره بفرست.');
    const { data } = await supa.from('registered_chats').select('chat_id,title').eq('chat_id', raw).maybeSingle();
    if (!data) return safeSendMessage(uid, '❌ چنین آیدی در مناطق ثبت‌شده نیست. ابتدا در آن گروه /on بزن و دوباره تلاش کن.');
    const confirmKey = st.step === 'fromIdInput' ? `wz:from:confirm:${raw}` : `wz:to:confirm:${raw}`;
    return safeSendMessage(uid, `آیا منظورت این گروه است؟\n\n${data.title || '-'}\n${data.chat_id}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ بله، انتخابش کن', confirmKey)],
        [Markup.button.callback('↩️ برگشت', st.step === 'fromIdInput' ? 'wz:from:list:1' : 'wz:to:list:1')],
        [Markup.button.callback('❌ لغو', 'wz:cancel')]
      ])
    );
  }

  // دریافت لیبل رفت
  if (st.step === 3) {
    st.labelF = (ctx.message.text || '').trim();
    st.step = 'sectionMode';
    return safeSendMessage(uid, 'نام «بخش/صفحه» را انتخاب کن (برای مرتب‌سازی مسیرها):',
      Markup.inlineKeyboard([
        [Markup.button.callback('📂 استفاده از «اصلی»', 'wz:sec:default')],
        [Markup.button.callback('✍️ خودم می‌نویسم', 'wz:sec:manual')],
        [Markup.button.callback('❌ لغو', 'wz:cancel')]
      ]));
  }

  // دریافت نام بخش دستی
  if (st.step === 'secInput') {
    st.section = (ctx.message.text || '').trim() || 'اصلی';
    st.step = 'labelBackMode';
    return safeSendMessage(uid, 'لیبل برگشت را چطور می‌خواهی؟',
      Markup.inlineKeyboard([
        [Markup.button.callback('✨ خودکار', 'wz:label:auto')],
        [Markup.button.callback('✍️ دستی', 'wz:label:manual')],
        [Markup.button.callback('❌ لغو', 'wz:cancel')]
      ]));
  }

  // لیبل برگشت دستی
  if (st.step === 'labelBInput') {
    st.labelB = (ctx.message.text || '').trim();
    st.step = 4;
    return safeSendMessage(uid, '⏱ زمان رفت (ثانیه) را بفرست (مثلاً 300). یا دکمهٔ زیر:',
      Markup.inlineKeyboard([
        [Markup.button.callback('استفاده از پیش‌فرض (300)', 'wz:tf:default')],
        [Markup.button.callback('❌ لغو','wz:cancel')]
      ]));
  }

  // زمان‌ها
  if (st.step === 4) {
    const t = (ctx.message.text || '').trim();
    st.tf = (t.toLowerCase() === 'default') ? 300 : parseInt(t, 10);
    if (!Number.isFinite(st.tf) || st.tf <= 0) return safeSendMessage(uid, '⛔️ عدد معتبر بفرست یا «پیش‌فرض (300)».');
    st.step = 5;
    return safeSendMessage(uid, '⏱ زمان برگشت (ثانیه) را بفرست (مثلاً 300). یا دکمهٔ زیر:',
      Markup.inlineKeyboard([[Markup.button.callback('استفاده از پیش‌فرض (300)', 'wz:tb:default')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }
  if (st.step === 5) {
    const t = (ctx.message.text || '').trim();
    st.tb = (t.toLowerCase() === 'default') ? 300 : parseInt(t, 10);
    if (!Number.isFinite(st.tb) || st.tb <= 0) return safeSendMessage(uid, '⛔️ عدد معتبر بفرست یا «پیش‌فرض (300)».');
    st.step = 6;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('✅ ایجاد لینک‌های رفت/برگشت', 'wz:confirm')],
      [Markup.button.callback('↩️ ویرایش زمان‌ها', 'wz:edit_times')],
      [Markup.button.callback('❌ لغو', 'wz:cancel')]
    ]);
    const summary = `بررسی نهایی:
from: ${st.fromId}
to:   ${st.toId}
section: ${st.section || 'اصلی'}
label→: ${st.labelF}
label←: ${st.labelB || '(خودکار)'}
forward: ${st.tf}s
back:    ${st.tb}s`;
    return safeSendMessage(uid, summary, kb);
  }

  return next();
});

async function handleWizardAction(ctx){
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  if (ctx.chat?.type !== 'private') { await ctx.answerCbQuery('ویزارد در PV اجرا می‌شود'); return; }
  const uid = ctx.from.id;
  const st = wzState(uid);
  const data = ctx.callbackQuery.data;

  const reply = async (text, kb) => {
    try { await ctx.editMessageText(text, kb); }
    catch { await safeSendMessage(uid, text, kb); }
    await ctx.answerCbQuery();
  };

  if (data === 'wz:cancel') {
    wizard.delete(uid); await ctx.answerCbQuery('لغو شد');
    try { await ctx.editMessageText('وِیزارد لغو شد.'); } catch { await safeSendMessage(uid, 'وِیزارد لغو شد.'); }
    return;
  }

  if (data === 'wz:from:this') {
    st.fromId = st.lastGroupId || null;
    if (!st.fromId) {
      return reply('مبدأ مشخص نیست. یکی از گزینه‌ها را انتخاب کن:', Markup.inlineKeyboard([
        [Markup.button.callback('📜 انتخاب مبدأ از لیست', 'wz:from:list:1')],
        [Markup.button.callback('🔎 جستجوی مبدأ با آیدی', 'wz:from:find')],
        [Markup.button.callback('❌ لغو', 'wz:cancel')]
      ]));
    }
    st.step = 2;
    return reply(`مبدأ تنظیم شد: ${st.fromId}\nحالا مقصد را انتخاب کن.`, Markup.inlineKeyboard([
      [Markup.button.callback('📜 انتخاب مقصد از لیست', 'wz:to:list:1')],
      [Markup.button.callback('🔎 جستجوی مقصد با آیدی', 'wz:to:find')],
      [Markup.button.callback('↩️ تغییر مبدأ', 'wz:from:list:1')],
      [Markup.button.callback('❌ لغو', 'wz:cancel')]
    ]));
  }

  if (data.startsWith('wz:from:list:')) {
    const page = parseInt(data.split(':').pop(), 10) || 1;
    const { items, pages } = await pagedRegisteredChats(page, 8, null);
    const rows = items.map(it => [Markup.button.callback(`${it.title || it.chat_id}`, `wz:from:set:${it.chat_id}`)]);
    rows.push([
      Markup.button.callback('◀️', `wz:from:list:${Math.max(1, page-1)}`),
      Markup.button.callback(`${page}/${pages}`, 'wz:nop'),
      Markup.button.callback('▶️', `wz:from:list:${Math.min(pages, page+1)}`)
    ]);
    rows.push([Markup.button.callback('🔎 جستجو با آیدی', 'wz:from:find')]);
    rows.push([Markup.button.callback('❌ لغو', 'wz:cancel')]);
    return reply('مبدأ را از لیست انتخاب کن:', Markup.inlineKeyboard(rows, { columns: 1 }));
  }

  if (data === 'wz:from:find') {
    st.step = 'fromIdInput';
    return reply('آیدی عددی گروه مبدأ را بفرست (مثل -1001234567890).', Markup.inlineKeyboard([[Markup.button.callback('❌ لغو', 'wz:cancel')]]));
  }

  if (data.startsWith('wz:from:set:')) {
    st.fromId = data.split(':').pop(); st.step = 2;
    return reply(`مبدأ: ${st.fromId}\nحالا مقصد را انتخاب کن.`, Markup.inlineKeyboard([
      [Markup.button.callback('📜 انتخاب مقصد از لیست', 'wz:to:list:1')],
      [Markup.button.callback('🔎 جستجوی مقصد با آیدی', 'wz:to:find')],
      [Markup.button.callback('↩️ تغییر مبدأ', 'wz:from:list:1')],
      [Markup.button.callback('❌ لغو', 'wz:cancel')]
    ]));
  }

  if (data.startsWith('wz:to:list:')) {
    if (!st.fromId) return ctx.answerCbQuery('اول مبدأ را انتخاب کن');
    const page = parseInt(data.split(':').pop(), 10) || 1;
    const { items, pages } = await pagedRegisteredChats(page, 8, st.fromId);
    const rows = items.map(it => [Markup.button.callback(`${it.title || it.chat_id}`, `wz:to:set:${it.chat_id}`)]);
    rows.push([
      Markup.button.callback('◀️', `wz:to:list:${Math.max(1, page-1)}`),
      Markup.button.callback(`${page}/${pages}`, 'wz:nop'),
      Markup.button.callback('▶️', `wz:to:list:${Math.min(pages, page+1)}`)
    ]);
    rows.push([Markup.button.callback('🔎 جستجو با آیدی', 'wz:to:find')]);
    rows.push([Markup.button.callback('↩️ تغییر مبدأ', 'wz:from:list:1')], [Markup.button.callback('❌ لغو', 'wz:cancel')]);
    return reply('مقصد را از لیست انتخاب کن:', Markup.inlineKeyboard(rows, { columns: 1 }));
  }

  if (data === 'wz:to:find') {
    st.step = 'toIdInput';
    return reply('آیدی عددی گروه مقصد را بفرست (مثل -1001234567890).', Markup.inlineKeyboard([[Markup.button.callback('❌ لغو', 'wz:cancel')]]));
  }

  if (data.startsWith('wz:to:set:')) {
    st.toId = data.split(':').pop(); st.step = 3;
    return reply(`مبدأ: ${st.fromId}\nمقصد: ${st.toId}\n\nلیبلِ رفت را بنویس (مثلاً: «ورود به شهر»)\n(پیام متنی بفرست)`);
  }

  if (data.startsWith('wz:from:confirm:')) {
    st.fromId = data.split(':').pop(); st.step = 2;
    return reply(`مبدأ: ${st.fromId}\nحالا مقصد را انتخاب کن.`, Markup.inlineKeyboard([
      [Markup.button.callback('📜 انتخاب مقصد از لیست', 'wz:to:list:1')],
      [Markup.button.callback('🔎 جستجوی مقصد با آیدی', 'wz:to:find')],
      [Markup.button.callback('↩️ تغییر مبدأ', 'wz:from:list:1')],
      [Markup.button.callback('❌ لغو', 'wz:cancel')]
    ]));
  }
  if (data.startsWith('wz:to:confirm:')) {
    st.toId = data.split(':').pop(); st.step = 3;
    return reply(`مبدأ: ${st.fromId}\nمقصد: ${st.toId}\n\nلیبلِ رفت را بنویس (مثلاً: «ورود به شهر»)\n(پیام متنی بفرست)`);
  }

  // بخش
  if (data === 'wz:sec:default') {
    st.section = 'اصلی';
    st.step = 'labelBackMode';
    return reply('لیبل برگشت را چطور می‌خواهی؟',
      Markup.inlineKeyboard([
        [Markup.button.callback('✨ خودکار', 'wz:label:auto')],
        [Markup.button.callback('✍️ دستی', 'wz:label:manual')],
        [Markup.button.callback('❌ لغو', 'wz:cancel')]
      ]));
  }
  if (data === 'wz:sec:manual') {
    st.step = 'secInput';
    return reply('نام بخش/صفحه را بفرست (مثلاً بازار / دروازه‌ها / شمال شهر).',
      Markup.inlineKeyboard([[Markup.button.callback('❌ لغو', 'wz:cancel')]]));
  }

  // لیبل برگشت
  if (data === 'wz:label:auto') {
    const tFrom = await getChatTitle(st.fromId);
    st.labelB = `بازگشت به ${tFrom}`;
    st.step = 4;
    return reply('⏱ زمان رفت (ثانیه) را بفرست (مثلاً 300). یا دکمهٔ زیر:',
      Markup.inlineKeyboard([[Markup.button.callback('استفاده از پیش‌فرض (300)', 'wz:tf:default')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }
  if (data === 'wz:label:manual') {
    st.step = 'labelBInput';
    return reply('لیبلِ برگشت را بنویس (مثلاً: «خروج به بیرون شهر»)\n(پیام متنی بفرست)',
      Markup.inlineKeyboard([[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }

  // زمان‌ها
  if (data === 'wz:tf:default') {
    st.tf = 300; st.step = 5;
    return reply('⏱ زمان برگشت (ثانیه) را بفرست (مثلاً 300). یا دکمهٔ زیر:',
      Markup.inlineKeyboard([[Markup.button.callback('استفاده از پیش‌فرض (300)', 'wz:tb:default')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }
  if (data === 'wz:tb:default') {
    st.tb = 300; st.step = 6;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('✅ ایجاد لینک‌های رفت/برگشت', 'wz:confirm')],
      [Markup.button.callback('↩️ ویرایش زمان‌ها', 'wz:edit_times')],
      [Markup.button.callback('❌ لغو', 'wz:cancel')]
    ]);
    const summary = `بررسی نهایی:
from: ${st.fromId}
to:   ${st.toId}
section: ${st.section || 'اصلی'}
label→: ${st.labelF}
label←: ${st.labelB || '(خودکار)'}
forward: ${st.tf}s
back:    ${st.tb}s`;
    return reply(summary, kb);
  }
  if (data === 'wz:edit_times') {
    st.step = 4;
    return reply('⏱ زمان رفت (ثانیه) را بفرست (مثلاً 300). یا دکمهٔ زیر:',
      Markup.inlineKeyboard([[Markup.button.callback('استفاده از پیش‌فرض (300)', 'wz:tf:default')],[Markup.button.callback('❌ لغو','wz:cancel')]]));
  }

  // تایید ایجاد
  if (data === 'wz:confirm') {
    if (!st.fromId || !st.toId || !st.labelF || !st.tf || !st.tb) return ctx.answerCbQuery('اطلاعات ناقص است');
    const section = st.section || 'اصلی';
    const forward = { from_chat_id: st.fromId, to_chat_id: st.toId, label: st.labelF, emoji:'🧭', base_travel_sec: parseInt(st.tf,10), invite_url:'-', active:true, section, order_index:0 };
    const backLbl = st.labelB || `بازگشت به ${await getChatTitle(st.fromId)}`;
    const backward= { from_chat_id: st.toId, to_chat_id: st.fromId, label: backLbl, emoji:'🧭', base_travel_sec: parseInt(st.tb,10), invite_url:'-', active:true, section, order_index:0 };
    const { data:f } = await supa.from('gates').insert(forward).select('id').single();
    const { data:b } = await supa.from('gates').insert(backward).select('id').single();
    if (f?.id && b?.id) {
      await supa.from('gates').update({ inverse_gate_id: b.id }).eq('id', f.id);
      await supa.from('gates').update({ inverse_gate_id: f.id }).eq('id', b.id);
    }
    cache.del(`gates:${st.fromId}`); cache.del(`gates:${st.toId}`);
    wizard.delete(uid);
    return reply('✅ لینک‌های رفت/برگشت ساخته شد');
  }

  return ctx.answerCbQuery();
}

async function pagedRegisteredChats(page=1, pageSize=8, excludeId=null){
  const k='registered:list:all';
  let list=cache.get(k);
  if(!list){ const { data } = await supa.from('registered_chats').select('chat_id,title').order('title',{ascending:true}).limit(5000); list=data||[]; cache.set(k,list,300); }
  const filtered = excludeId ? list.filter(x=>`${x.chat_id}`!==`${excludeId}`) : list;
  const pages = Math.max(1, Math.ceil(filtered.length/pageSize));
  const start = (page-1)*pageSize; const items = filtered.slice(start,start+pageSize);
  return { items, page, pages };
}

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
  // catch-up scheduled movements (۲ دقیقه پنجره)
  try{
    const from = new Date(Date.now()-120_000).toISOString();
    const to = new Date(Date.now()+120_000).toISOString();
    const { data } = await supa.from('movements').select('move_id,user_id,to_chat_id,arrive_at,state')
      .eq('state','scheduled').gte('arrive_at',from).lte('arrive_at',to).limit(500);
    for (const m of (data||[])) scheduleArrival(m);
  }catch{}
});

process.on('unhandledRejection', (e)=>console.log('Unhandled:', e?.message || e));
