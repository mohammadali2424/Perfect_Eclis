/**
 * Unified RPG World Bot — with Link Wizard & Region Lock
 * Render/Supabase Free Friendly (text-only)
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

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 9_000 });
const supa = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const app = express();
app.use(express.json());

const cache = new NodeCache({ stdTTL: 600, checkperiod: 120, maxKeys: 10000 });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('LOCAL_TIMEOUT')), ms))]);

let ME_ID = null;
(async () => { try { ME_ID = (await bot.telegram.getMe()).id; } catch {} })();

const isOwner = (ctx) => ctx.from?.id === OWNER_ID;
const replyNotOwner = async (ctx) => {
  try { await ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده', { reply_to_message_id: ctx.message?.message_id }); } catch {}
};
const ensureOwner = (ctx) => { if (isOwner(ctx)) return true; replyNotOwner(ctx); return false; };

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
      supa.from('registered_chats').select('chat_id').eq('chat_id', `${chatId}`).single(),
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
  const { data } = await supa.from('registered_chats').select('locked, locked_message').eq('chat_id', `${chatId}`).single();
  const st = { locked: !!data?.locked, msg: data?.locked_message || 'این منطقه فعلاً بسته است.' };
  cache.set(k, st, 300);
  return st;
};

// ------- Rate limiting -------
const globalQueue = [];
let sending = false;
const SEND_RATE_DELAY = 70; // ~14 msg/sec

async function enqueueSend(fn) {
  return new Promise((resolve) => {
    globalQueue.push({ fn, resolve });
    if (!sending) pump();
  });
}
async function pump() {
  sending = true;
  while (globalQueue.length) {
    const { fn, resolve } = globalQueue.shift();
    try { resolve(await fn()); } catch (e) { resolve(Promise.reject(e)); }
    await sleep(SEND_RATE_DELAY);
  }
  sending = false;
}
async function safeSendMessage(chatId, text, extra = {}) {
  try {
    return await enqueueSend(() => bot.telegram.sendMessage(chatId, text, extra));
  } catch (e) {
    const m = String(e.message || e);
    if (/429|timeout|ETELEGRAM/.test(m)) {
      await sleep(500);
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
  const { data, error } = await withTimeout(
    supa.from('gates')
      .select('id, from_chat_id, to_chat_id, label, emoji, base_travel_sec, active, rule_json')
      .eq('from_chat_id', `${fromChatId}`)
      .eq('active', true)
      .limit(200),
    6000
  );
  if (error) return [];
  cache.set(k, data || [], 600);
  return data || [];
}
async function upsertPlayer(p) { await supa.from('players').upsert(p, { onConflict: 'user_id' }); }
async function upsertMovement(m) { await supa.from('movements').upsert(m, { onConflict: 'move_id' }); }

function newMoveId(userId, gateId) { return `${userId}_${gateId}_${Date.now()}`; }

async function createOneTimeInvite(destChatId, userId, gateId, ttlSec) {
  const expireAt = Math.floor(Date.now() / 1000) + Math.max(60, Math.min(ttlSec, 600));
  return await bot.telegram.createChatInviteLink(destChatId, {
    expire_date: expireAt,
    member_limit: 1,
    creates_join_request: true,
    name: `ticket-${userId}-${gateId}`
  });
}

// ------- Quarantine & removal -------
async function softKickFromChat(chatId, userId) {
  try {
    if (!await isBotAdmin(chatId)) return false;
    try {
      const m = await bot.telegram.getChatMember(chatId, userId);
      if (['left', 'kicked', 'creator'].includes(m.status)) return true;
    } catch {}
    await bot.telegram.banChatMember(chatId, userId);
    setTimeout(() => bot.telegram.unbanChatMember(chatId, userId).catch(()=>{}), 10_000);
    await sleep(80);
    return true;
  } catch { return false; }
}
async function removeFromOtherChats(allowedChatId, userId) {
  const k = 'registered:list';
  let regs = cache.get(k);
  if (!regs) {
    const { data } = await supa.from('registered_chats').select('chat_id').limit(2000);
    regs = data || [];
    cache.set(k, regs, 600);
  }
  for (const r of regs) {
    const cid = `${r.chat_id}`;
    if (cid === `${allowedChatId}`) continue;
    await softKickFromChat(cid, userId);
  }
}

// ------- Menu & arrival -------
function humanizeSeconds(sec) {
  sec = Math.max(1, Math.round(sec));
  if (sec < 60) return `${sec} ثانیه`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m} دقیقه و ${s} ثانیه` : `${m} دقیقه`;
}

async function fetchLockMap(chatIds) {
  if (!chatIds.length) return {};
  const { data } = await supa.from('registered_chats')
    .select('chat_id, locked').in('chat_id', chatIds.map(String));
  const map = {};
  for (const r of (data || [])) map[`${r.chat_id}`] = !!r.locked;
  return map;
}

async function buildMenuFor(chatId, userId) {
  await ensureAllowedChat(chatId);
  const gates = await getGatesFrom(chatId);
  const toIds = gates.map(g => `${g.to_chat_id}`);
  const lockMap = await fetchLockMap([...new Set(toIds)]);

  // 👣 Footprints (۲ دقیقه)
  let footprintBtn = null;
  try {
    const { data: fps } = await supa
      .from('footprints')
      .select('user_display, origin_chat_id, expires_at')
      .eq('chat_id', `${chatId}`)
      .gt('expires_at', nowIso())
      .order('expires_at', { ascending: false })
      .limit(1);
    if (fps && fps.length) {
      footprintBtn = Markup.button.callback(
        `👣 پی‌گرفتن ردِ ${fps[0].user_display || 'بازیکن'} — 2 دقیقه`,
        `ticket:footprint:${fps[0].origin_chat_id}:120`
      );
    }
  } catch {}

  const rows = [];
  if (footprintBtn) rows.push([footprintBtn]);

  for (const g of gates.slice(0, 24)) {
    let eta = g.base_travel_sec;
    // 🔥 Relay Candles (بوست 5%)
    try {
      const { data: c } = await supa
        .from('relay_candles')
        .select('charges_left, expires_at')
        .eq('gate_id', g.id).single();
      if (c && c.charges_left > 0 && new Date(c.expires_at) > new Date()) {
        eta = Math.round(eta * 0.95);
      }
    } catch {}

    const locked = !!lockMap[`${g.to_chat_id}`];
    const labelText = `${locked ? '⛔️ ' : ''}${g.emoji || '🧭'} ${g.label} — ${humanizeSeconds(eta)}`;
    rows.push([Markup.button.callback(labelText, `ticket:gate:${g.id}:${eta}`)]);
  }

  return Markup.inlineKeyboard(rows, { columns: 1 });
}

async function sendArrivalMessage(destChatId, userId) {
  const kb = await buildMenuFor(destChatId, userId);
  const text = '🎴┊وارد شدی؛ هوای اینجا بوی ماجرا می‌دهد...\n\nمسیرهای پیشِ رو:';
  await safeSendMessage(destChatId, text, kb);
}

// ------- Movement scheduling -------
const scheduledJobs = new Map();

async function scheduleArrival(move) {
  const delay = Math.max(0, new Date(move.arrive_at).getTime() - Date.now());
  if (delay > 60 * 60 * 1000) return;
  if (scheduledJobs.has(move.move_id)) return;
  const tid = setTimeout(async () => {
    scheduledJobs.delete(move.move_id);
    try {
      const { data: m } = await supa.from('movements')
        .select('state, to_chat_id, user_id, gate_id')
        .eq('move_id', move.move_id).single();
      if (!m || m.state !== 'scheduled') return;
      await sendArrivalMessage(m.to_chat_id, m.user_id);
      await supa.from('players').update({ status: 'idle', updated_at: nowIso() }).eq('user_id', m.user_id);
      // 👣 ردپا
      const { data: pl } = await supa.from('players').select('last_chat_id').eq('user_id', m.user_id).single();
      await supa.from('footprints').upsert({
        chat_id: `${m.to_chat_id}`,
        user_id: m.user_id,
        origin_chat_id: pl?.last_chat_id || null,
        user_display: '',
        expires_at: new Date(Date.now() + 120_000).toISOString()
      });
      // 🔥 شمع رله
      if (m.gate_id) {
        await supa.from('relay_candles').upsert({
          gate_id: m.gate_id,
          charges_left: 3,
          expires_at: new Date(Date.now() + 300_000).toISOString()
        });
      }
      await supa.from('movements').update({ state: 'arrived' }).eq('move_id', move.move_id);
    } catch {}
  }, delay);
  scheduledJobs.set(move.move_id, tid);
}

async function bootCatchUp() {
  const from = new Date(Date.now() - 120_000).toISOString();
  const to = new Date(Date.now() + 120_000).toISOString();
  const { data } = await supa.from('movements')
    .select('move_id, user_id, to_chat_id, arrive_at, state, gate_id')
    .eq('state', 'scheduled')
    .gte('arrive_at', from)
    .lte('arrive_at', to)
    .limit(500);
  for (const m of (data || [])) scheduleArrival(m);
}

// ------- Tickets via callbacks -------
bot.on('callback_query', async (ctx) => {
  try {
    const cb = ctx.callbackQuery;
    const data = cb.data || '';
    const chatId = ctx.chat?.id;
    const userId = cb.from?.id;

    if (!await ensureAllowedChat(chatId)) return ctx.answerCbQuery('منطقه فعال نیست');
    if (!data.startsWith('ticket:')) return ctx.answerCbQuery();

    let toChatId = null, etaSec = null, gateId = null;

    if (data.startsWith('ticket:gate:')) {
      const [, , , gId, etaStr] = data.split(':');
      gateId = parseInt(gId, 10);
      etaSec = parseInt(etaStr, 10);
      const { data: g } = await supa.from('gates')
        .select('id, from_chat_id, to_chat_id, base_travel_sec')
        .eq('id', gateId).single();
      if (!g || `${g.from_chat_id}` !== `${chatId}`) return ctx.answerCbQuery('مسیر نامعتبر');
      toChatId = g.to_chat_id;

      // قفل مقصد؟
      const destState = await getRegionState(`${toChatId}`);
      if (destState.locked) return ctx.answerCbQuery(destState.msg || '⛔️ منطقه بسته است');

      // مصرف شارژ شمع
      try { await supa.rpc('consume_candle', { p_gate_id: gateId }); } catch {}

    } else if (data.startsWith('ticket:footprint:')) {
      const [, , , originChatId, etaStr] = data.split(':');
      toChatId = originChatId;
      etaSec = parseInt(etaStr, 10);
      gateId = null;
      // قفل مقصد؟
      const destState = await getRegionState(`${toChatId}`);
      if (destState.locked) return ctx.answerCbQuery(destState.msg || '⛔️ منطقه بسته است');
    } else {
      return ctx.answerCbQuery();
    }

    // ساخت بلیت یک‌بارمصرف
    const link = await createOneTimeInvite(toChatId, userId, gateId || 0, 5 * 60);

    const moveId = newMoveId(userId, gateId || 0);
    const depart = nowIso();
    const arrive = new Date(Date.now() + (etaSec * 1000)).toISOString();

    await upsertPlayer({
      user_id: userId,
      current_chat_id: `${toChatId}`,
      last_chat_id: `${chatId}`,
      status: 'quarantined',
      updated_at: depart
    });
    await upsertMovement({
      move_id: moveId,
      user_id: userId,
      from_chat_id: `${chatId}`,
      to_chat_id: `${toChatId}`,
      gate_id: gateId,
      departed_at: depart,
      arrive_at: arrive,
      state: 'scheduled',
      ticket_id: moveId,
      ticket_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      invite_link: link.invite_link
    });

    removeFromOtherChats(`${toChatId}`, userId).catch(()=>{});
    scheduleArrival({ move_id: moveId, arrive_at: arrive, gate_id: gateId, to_chat_id: toChatId, user_id: userId });

    try {
      await bot.telegram.sendMessage(userId,
        `🎟️ بلیت مقصد آماده شد.\n\nبرای ورود کلیک کن:`,
        Markup.inlineKeyboard([[Markup.button.url('ورود به مقصد', link.invite_link)]])
      );
      await ctx.answerCbQuery('لینک در PV ارسال شد');
    } catch {
      await ctx.answerCbQuery('PV بات را استارت کن');
      await safeSendMessage(chatId, `[${cb.from.first_name}](tg://user?id=${userId})\nبرای دریافت لینک، PV بات را استارت کن`, { parse_mode: 'Markdown' });
    }

  } catch { try { await ctx.answerCbQuery('خطا'); } catch {} }
});

// ------- Approve join requests -------
bot.on('chat_join_request', async (ctx) => {
  try {
    const req = ctx.update.chat_join_request;
    const userId = req.from.id;
    const chatId = `${req.chat.id}`;
    const usedLink = req.invite_link?.invite_link || '';

    // اگر منطقه قفل است، رد کن
    const destState = await getRegionState(chatId);
    if (destState.locked) { await ctx.declineChatJoinRequest(userId); return; }

    const { data } = await supa.from('movements')
      .select('move_id, state, to_chat_id, user_id, ticket_expires_at, invite_link')
      .eq('user_id', userId)
      .eq('to_chat_id', chatId)
      .eq('state', 'scheduled')
      .order('departed_at', { ascending: false })
      .limit(1);

    const mv = (data && data[0]) || null;
    if (!mv) { await ctx.declineChatJoinRequest(userId); return; }

    const notExpired = new Date(mv.ticket_expires_at) > new Date();
    const linkMatch = mv.invite_link === usedLink;

    if (notExpired && linkMatch) {
      await ctx.approveChatJoinRequest(userId);
      await supa.from('players').upsert({
        user_id: userId, current_chat_id: chatId, status: 'quarantined', updated_at: nowIso()
      }, { onConflict: 'user_id' });
    } else {
      await ctx.declineChatJoinRequest(userId);
    }
  } catch {}
});

// ------- Text Triggers -------
bot.hears(/^#خروج$/i, async (ctx) => {
  const user = ctx.message?.from;
  if (!user || user.is_bot) return;
  try { await ctx.reply(`🧭┊سفر به سلامت ${user.first_name || ''}`, { reply_to_message_id: ctx.message.message_id }); } catch {}
});

// ------- Commands: base -------
bot.start((ctx) => ctx.reply('نینجا در خدمت شماست 🥷🏻'));

bot.command('on', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`;
  const title = ctx.chat.title || 'بدون عنوان';
  const { error } = await supa.from('registered_chats')
    .upsert({ chat_id: chatId, title, created_at: nowIso() }, { onConflict: 'chat_id' });
  cache.del(`allowed:${chatId}`); cache.del('registered:list'); cache.del(`region:${chatId}`);
  if (error) return ctx.reply('❌ خطا در ثبت منطقه');
  ctx.reply('✅ منطقه ثبت شد');
});

bot.command('off', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`;
  await supa.from('registered_chats').delete().eq('chat_id', chatId);
  cache.del(`allowed:${chatId}`); cache.del('registered:list'); cache.del(`region:${chatId}`);
  await ctx.reply('✅ منطقه حذف شد؛ ربات لفت می‌دهد…');
  try { await ctx.leaveChat(); } catch {}
});

// VIP / UNVIP / FREE
bot.command('vip', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const t = ctx.message?.reply_to_message?.from;
  if (!t) return ctx.reply('روی پیام کاربر ریپلای کن بعد /vip بزن');
  await supa.from('vip_users').upsert({ user_id: t.id, added_at: nowIso() }, { onConflict: 'user_id' });
  await supa.from('players').delete().eq('user_id', t.id);
  ctx.reply(`✅ ${t.first_name} VIP شد`);
});
bot.command('unvip', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const t = ctx.message?.reply_to_message?.from;
  if (!t) return ctx.reply('روی پیام کاربر ریپلای کن بعد /unvip بزن');
  await supa.from('vip_users').delete().eq('user_id', t.id);
  ctx.reply(`✅ ${t.first_name} از VIP خارج شد`);
});
bot.command('free', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const t = ctx.message?.reply_to_message?.from;
  if (!t) return ctx.reply('روی پیام کاربر ریپلای کن بعد /free بزن');
  await supa.from('players').delete().eq('user_id', t.id);
  ctx.reply(`✅ ${t.first_name} از قرنطینه خارج شد`);
});

// ------- Region Lock / Unlock -------
bot.command('lock', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`;
  await supa.from('registered_chats').update({ locked: true }).eq('chat_id', chatId);
  cache.del(`region:${chatId}`);
  ctx.reply('⛔️ این منطقه قفل شد');
});
bot.command('unlock', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`;
  await supa.from('registered_chats').update({ locked: false }).eq('chat_id', chatId);
  cache.del(`region:${chatId}`);
  ctx.reply('✅ این منطقه باز شد');
});
bot.command('toggle_lock', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`;
  const st = await getRegionState(chatId);
  await supa.from('registered_chats').update({ locked: !st.locked }).eq('chat_id', chatId);
  cache.del(`region:${chatId}`);
  ctx.reply(!st.locked ? '⛔️ قفل شد' : '✅ باز شد');
});

// ------- Gates list & unlink -------
bot.command('listgates', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const fromId = `${ctx.chat.id}`;
  const { data, error } = await supa.from('gates')
    .select('id, to_chat_id, label, base_travel_sec, inverse_gate_id')
    .eq('from_chat_id', fromId).eq('active', true).limit(200);
  if (error) return ctx.reply('❌ خطا');
  if (!data || !data.length) return ctx.reply('هیچ مسیری ثبت نیست');
  let out = 'گیت‌های فعال از این منطقه:\n';
  for (const g of data) {
    out += `• #${g.id} → ${g.to_chat_id} | ${g.label} | ${g.base_travel_sec}s`;
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
  cache.del(`gates:${fromId}`); cache.del(`gates:${toId}`);
  ctx.reply('✅ لینک‌های رفت/برگشت حذف شد');
});

// ------- Link Wizard (ساده و کم‌هزینه) -------
const wizard = new Map(); // ownerId -> {step, fromId, toId, label, tf, tb, pageFrom, pageTo}

async function pagedRegisteredChats(page = 1, pageSize = 8, excludeId = null) {
  const k = 'registered:list:all';
  let list = cache.get(k);
  if (!list) {
    const { data } = await supa.from('registered_chats').select('chat_id, title').order('title', { ascending: true }).limit(5000);
    list = data || [];
    cache.set(k, list, 300);
  }
  const filtered = excludeId ? list.filter(x => `${x.chat_id}` !== `${excludeId}`) : list;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);
  return { items, page, pages };
}

function wzState(uid) {
  if (!wizard.has(uid)) wizard.set(uid, { step: 0 });
  return wizard.get(uid);
}

bot.command('link_wizard', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const uid = ctx.from.id;
  wizard.set(uid, { step: 1 });
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('✔️ همین گروه به‌عنوان مبدأ', 'wz:from:this')],
    [Markup.button.callback('📜 انتخاب از لیست مناطق', 'wz:from:list:1')],
    [Markup.button.callback('❌ لغو', 'wz:cancel')]
  ]);
  ctx.reply('وِیزارد لینک: مبدأ را انتخاب کن.', kb);
});

bot.action(/^wz:cancel$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  wizard.delete(ctx.from.id);
  await ctx.answerCbQuery('لغو شد');
  try { await ctx.editMessageText('وِیزارد لغو شد.'); } catch {}
});

bot.action(/^wz:from:this$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const st = wzState(ctx.from.id);
  st.fromId = `${ctx.chat.id}`;
  st.step = 2;
  await ctx.answerCbQuery('مبدأ = همین گروه');
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('📜 انتخاب مقصد از لیست', 'wz:to:list:1')],
    [Markup.button.callback('↩️ برگرد', 'wz:from:list:1')],
    [Markup.button.callback('❌ لغو', 'wz:cancel')]
  ]);
  try { await ctx.editMessageText(`مبدأ تنظیم شد: ${st.fromId}\nحالا مقصد را انتخاب کن.`, kb); } catch {}
});

bot.action(/^wz:from:list:(\d+)$/i, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const page = parseInt(ctx.match[1], 10) || 1;
  const { items, pages } = await pagedRegisteredChats(page, 8, null);
  const rows = items.map(it => [Markup.button.callback(`${it.title || it.chat_id}`, `wz:from:set:${it.chat_id}`)]);
  const nav = [
    Markup.button.callback('◀️', `wz:from:list:${Math.max(1, page - 1)}`),
    Markup.button.callback(`${page}/${pages}`, 'wz:nop'),
    Markup.button.callback('▶️', `wz:from:list:${Math.min(pages, page + 1)}`)
  ];
  rows.push(nav);
  rows.push([Markup.button.callback('❌ لغو', 'wz:cancel')]);
  await ctx.editMessageText('مبدأ را از لیست انتخاب کن:', Markup.inlineKeyboard(rows, { columns: 1 }));
  await ctx.answerCbQuery();
});

bot.action(/^wz:nop$/, (ctx) => ctx.answerCbQuery());

bot.action(/^wz:from:set:(-?\d+)$/i, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const st = wzState(ctx.from.id);
  st.fromId = ctx.match[1];
  st.step = 2;
  await ctx.answerCbQuery('مبدأ انتخاب شد');
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('📜 انتخاب مقصد از لیست', 'wz:to:list:1')],
    [Markup.button.callback('↩️ تغییر مبدأ', 'wz:from:list:1')],
    [Markup.button.callback('❌ لغو', 'wz:cancel')]
  ]);
  try { await ctx.editMessageText(`مبدأ تنظیم شد: ${st.fromId}\nحالا مقصد را انتخاب کن.`, kb); } catch {}
});

bot.action(/^wz:to:list:(\d+)$/i, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const st = wzState(ctx.from.id);
  if (!st.fromId) return ctx.answerCbQuery('اول مبدأ را انتخاب کن');
  const page = parseInt(ctx.match[1], 10) || 1;
  const { items, pages } = await pagedRegisteredChats(page, 8, st.fromId);
  const rows = items.map(it => [Markup.button.callback(`${it.title || it.chat_id}`, `wz:to:set:${it.chat_id}`)]);
  const nav = [
    Markup.button.callback('◀️', `wz:to:list:${Math.max(1, page - 1)}`),
    Markup.button.callback(`${page}/${pages}`, 'wz:nop'),
    Markup.button.callback('▶️', `wz:to:list:${Math.min(pages, page + 1)}`)
  ];
  rows.push(nav);
  rows.push([Markup.button.callback('↩️ تغییر مبدأ', 'wz:from:list:1')]);
  rows.push([Markup.button.callback('❌ لغو', 'wz:cancel')]);
  await ctx.editMessageText('مقصد را از لیست انتخاب کن:', Markup.inlineKeyboard(rows, { columns: 1 }));
  await ctx.answerCbQuery();
});

bot.action(/^wz:to:set:(-?\d+)$/i, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const st = wzState(ctx.from.id);
  st.toId = ctx.match[1];
  st.step = 3;
  await ctx.answerCbQuery('مقصد انتخاب شد');
  try { await ctx.editMessageText(`مبدأ: ${st.fromId}\nمقصد: ${st.toId}\n\nیک برچسب برای مسیر بنویس (مثلاً: «قلعه↔شهر»)`); } catch {}
});

bot.on('text', async (ctx, next) => {
  if (!isOwner(ctx)) return next();
  const uid = ctx.from.id;
  const st = wizard.get(uid);
  if (!st) return next();

  // فقط پیام‌های مالک در ویزارد
  if (st.step === 3) {
    st.label = (ctx.message.text || '').trim();
    st.step = 4;
    return ctx.reply('⏱ زمان رفت (ثانیه) را بفرست (مثلاً 300 برای 5 دقیقه). یا بنویس: default', Markup.inlineKeyboard([
      [Markup.button.callback('استفاده از پیش‌فرض (300)', 'wz:tf:default')],
      [Markup.button.callback('❌ لغو', 'wz:cancel')]
    ]));
  }
  if (st.step === 4) {
    const t = (ctx.message.text || '').trim();
    st.tf = (t.toLowerCase() === 'default') ? 300 : parseInt(t, 10);
    if (!Number.isFinite(st.tf) || st.tf <= 0) return ctx.reply('⛔️ عدد معتبر بفرست یا بزن پیش‌فرض.');
    st.step = 5;
    return ctx.reply('⏱ زمان برگشت (ثانیه) را بفرست (مثلاً 300). یا بنویس: default', Markup.inlineKeyboard([
      [Markup.button.callback('استفاده از پیش‌فرض (300)', 'wz:tb:default')],
      [Markup.button.callback('❌ لغو', 'wz:cancel')]
    ]));
  }
  if (st.step === 5) {
    const t = (ctx.message.text || '').trim();
    st.tb = (t.toLowerCase() === 'default') ? 300 : parseInt(t, 10);
    if (!Number.isFinite(st.tb) || st.tb <= 0) return ctx.reply('⛔️ عدد معتبر بفرست یا بزن پیش‌فرض.');
    st.step = 6;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('✅ ایجاد لینک‌های رفت/برگشت', 'wz:confirm')],
      [Markup.button.callback('↩️ ویرایش زمان‌ها', 'wz:edit_times')],
      [Markup.button.callback('❌ لغو', 'wz:cancel')]
    ]);
    return ctx.reply(`بررسی نهایی:\nfrom: ${st.fromId}\nto: ${st.toId}\nlabel: ${st.label}\nforward: ${st.tf}s\nback: ${st.tb}s`, kb);
  }

  return next();
});

bot.action(/^wz:tf:default$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const st = wzState(ctx.from.id); st.tf = 300; st.step = 5;
  await ctx.answerCbQuery('300s');
  await ctx.editMessageText('⏱ زمان برگشت (ثانیه) را بفرست (مثلاً 300). یا بنویس: default', Markup.inlineKeyboard([
    [Markup.button.callback('استفاده از پیش‌فرض (300)', 'wz:tb:default')],
    [Markup.button.callback('❌ لغو', 'wz:cancel')]
  ]));
});
bot.action(/^wz:tb:default$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const st = wzState(ctx.from.id); st.tb = 300; st.step = 6;
  await ctx.answerCbQuery('300s');
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('✅ ایجاد لینک‌های رفت/برگشت', 'wz:confirm')],
    [Markup.button.callback('↩️ ویرایش زمان‌ها', 'wz:edit_times')],
    [Markup.button.callback('❌ لغو', 'wz:cancel')]
  ]);
  await ctx.editMessageText(`بررسی نهایی:\nfrom: ${st.fromId}\nto: ${st.toId}\nlabel: ${st.label}\nforward: ${st.tf}s\nback: ${st.tb}s`, kb);
});
bot.action(/^wz:edit_times$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const st = wzState(ctx.from.id); st.step = 4;
  await ctx.answerCbQuery();
  try { await ctx.editMessageText('⏱ زمان رفت (ثانیه) را بفرست (مثلاً 300). یا بنویس: default', Markup.inlineKeyboard([
    [Markup.button.callback('استفاده از پیش‌فرض (300)', 'wz:tf:default')],
    [Markup.button.callback('❌ لغو', 'wz:cancel')]
  ])); } catch {}
});

bot.action(/^wz:confirm$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const st = wzState(ctx.from.id);
  if (!st.fromId || !st.toId || !st.label || !st.tf || !st.tb) return ctx.answerCbQuery('ناقص است');

  // insert two directed gates
  const forward = {
    from_chat_id: st.fromId, to_chat_id: st.toId,
    label: `${st.label} (→)`, emoji: '🧭',
    base_travel_sec: parseInt(st.tf, 10), invite_url: '-', active: true
  };
  const backward = {
    from_chat_id: st.toId, to_chat_id: st.fromId,
    label: `${st.label} (←)`, emoji: '🧭',
    base_travel_sec: parseInt(st.tb, 10), invite_url: '-', active: true
  };
  const { data: f } = await supa.from('gates').insert(forward).select('id').single();
  const { data: b } = await supa.from('gates').insert(backward).select('id').single();
  if (f?.id && b?.id) {
    await supa.from('gates').update({ inverse_gate_id: b.id }).eq('id', f.id);
    await supa.from('gates').update({ inverse_gate_id: f.id }).eq('id', b.id);
  }
  cache.del(`gates:${st.fromId}`); cache.del(`gates:${st.toId}`);
  wizard.delete(ctx.from.id);

  await ctx.answerCbQuery('ساخته شد');
  try { await ctx.editMessageText('✅ لینک‌های رفت/برگشت ساخته شد'); } catch {}
});

// ------- Ownership-safe joining -------
bot.on('my_chat_member', async (ctx) => {
  try {
    const ns = ctx.update.my_chat_member?.new_chat_member?.status;
    const adderId = ctx.update.my_chat_member?.from?.id;
    const chatId = ctx.chat?.id;
    if (ns && ['member', 'administrator'].includes(ns)) {
      if (adderId !== OWNER_ID) {
        try { await bot.telegram.sendMessage(chatId, 'این ربات متعلق به مجموعه اکلیس است ، شما حق استفاده از آنها رو ندارین ، حدتو بدون'); } catch {}
        try { await bot.telegram.leaveChat(chatId); } catch {}
      }
    }
  } catch {}
});

// ------- Keep alive & GC -------
function startPing() {
  if (!RENDER_URL) return;
  const selfUrl = RENDER_URL;
  const INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  setInterval(() => axios.head(`${selfUrl}/ping`).catch(()=>{}), INTERVAL);
}
app.get('/ping', (_req, res) => res.status(200).json({ ok: true }));

async function gcEphemerals() {
  const ts = nowIso();
  await supa.from('footprints').delete().lt('expires_at', ts);
  await supa.from('relay_candles').delete().lt('expires_at', ts);
}
setInterval(gcEphemerals, 180_000);

// ------- Server / Webhook -------
app.use(bot.webhookCallback('/webhook'));
app.get('/', (_req, res) => res.send('<h3>RPG World Bot</h3>'));

app.listen(PORT, async () => {
  console.log('🚀 Bot on port', PORT);
  startPing();
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    if (RENDER_URL) {
      const url = `${RENDER_URL}/webhook`;
      await bot.telegram.setWebhook(url);
      console.log('✅ Webhook set:', url);
    } else {
      await bot.launch();
      console.log('✅ Long polling launched');
    }
  } catch (e) { console.log('Startup warn:', e.message); }
  bootCatchUp().catch(()=>{});
});

process.on('unhandledRejection', (e) => console.log('Unhandled:', e?.message || e));
