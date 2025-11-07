/**
 * Unified RPG World Bot (Quarantine + Trigger) — Render/Supabase Free Friendly
 * فقط متن + دکمه اینلاین؛ بدون مدیا. مقیاس‌پذیر تا ~۲۰۰۰ کاربر همزمان.
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Telegraf, Markup } = require('telegraf');
const NodeCache = require('node-cache');
const { createClient } = require('@supabase/supabase-js');

// ---------- ENV ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = parseInt(process.env.OWNER_ID || '0', 10);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY; // توصیه: SERVICE_ROLE
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || '';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!BOT_TOKEN || !OWNER_ID || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ ENV ناقص است: BOT_TOKEN, OWNER_ID, SUPABASE_URL, SUPABASE_KEY لازمند');
  process.exit(1);
}

// ---------- Infra ----------
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 9_000 });
const supa = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const app = express();
app.use(express.json());

const cache = new NodeCache({ stdTTL: 600, checkperiod: 120, maxKeys: 10000 });

// ---------- Helpers ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('LOCAL_TIMEOUT')), ms))]);

let ME_ID = null;
(async () => { try { ME_ID = (await bot.telegram.getMe()).id; } catch {} })();

const isOwner = (ctx) => ctx.from?.id === OWNER_ID;
const ensureOwner = (ctx) => { if (isOwner(ctx)) return true; replyNotOwner(ctx); return false; };
const replyNotOwner = async (ctx) => {
  try { await ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده', { reply_to_message_id: ctx.message?.message_id }); } catch {}
};

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

// ---------- Rate-limit (ملایم) ----------
const globalQueue = [];
let sending = false;
const SEND_RATE_DELAY = 70; // ~14 msg/sec globally

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
    const isMember = await isBotAdmin(chatId).catch(() => false);
    if (!isMember) { /* شاید admin نباشیم اما ارسال پیام لزوماً ادمین نمی‌خواهد */ }
    return await enqueueSend(() => bot.telegram.sendMessage(chatId, text, extra));
  } catch (e) {
    const m = String(e.message || e);
    if (/429|timeout|ETELEGRAM/.test(m)) {
      await sleep(500);
      try { return await enqueueSend(() => bot.telegram.sendMessage(chatId, text, extra)); } catch {}
    }
    // 403/400 retry نکن
    throw e;
  }
}

// ---------- DB: Regions & Gates ----------
async function getGatesFrom(fromChatId) {
  const k = `gates:${fromChatId}`;
  const c = cache.get(k);
  if (c) return c;
  const { data, error } = await withTimeout(
    supa.from('gates')
      .select('id, from_chat_id, to_chat_id, label, emoji, base_travel_sec, invite_url, active, rule_json')
      .eq('from_chat_id', `${fromChatId}`)
      .eq('active', true)
      .limit(200),
    6000
  );
  if (error) return [];
  cache.set(k, data || [], 600);
  return data || [];
}

async function upsertPlayer(p) {
  await supa.from('players').upsert(p, { onConflict: 'user_id' });
}

async function upsertMovement(m) {
  await supa.from('movements').upsert(m, { onConflict: 'move_id' });
}

// ---------- Tickets (در movements نگه می‌داریم) ----------
function newMoveId(userId, gateId) {
  return `${userId}_${gateId}_${Date.now()}`;
}

// ---------- One-time Invite ----------
async function createOneTimeInvite(destChatId, userId, gateId, ttlSec) {
  const expireAt = Math.floor(Date.now() / 1000) + Math.max(60, Math.min(ttlSec, 600));
  return await bot.telegram.createChatInviteLink(destChatId, {
    expire_date: expireAt,
    member_limit: 1,
    creates_join_request: true,
    name: `ticket-${userId}-${gateId}`
  });
}

// ---------- Quarantine & Removal ----------
async function softKickFromChat(chatId, userId) {
  try {
    // اگر ادمین نیستیم، کاری نکن
    if (!await isBotAdmin(chatId)) return false;
    // وضعیت کاربر
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
    const { data } = await supa.from('registered_chats').select('chat_id').limit(1000);
    regs = data || [];
    cache.set(k, regs, 600);
  }
  for (const r of regs) {
    const cid = `${r.chat_id}`;
    if (cid === `${allowedChatId}`) continue;
    await softKickFromChat(cid, userId);
  }
}

// ---------- Arrival Menu ----------
function humanizeSeconds(sec) {
  sec = Math.max(1, Math.round(sec));
  if (sec < 60) return `${sec} ثانیه`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} دقیقه و ${s} ثانیه` : `${m} دقیقه`;
}

async function buildMenuFor(chatId, userId) {
  const player = await supa.from('players')
    .select('current_chat_id, last_chat_id, status')
    .eq('user_id', userId).single();

  const gates = await getGatesFrom(chatId);

  // 👣 Footprints (۲ دقیقه)
  let footprintButton = null;
  try {
    const { data: fps } = await supa
      .from('footprints')
      .select('user_display, origin_chat_id, expires_at')
      .eq('chat_id', `${chatId}`)
      .gt('expires_at', nowIso())
      .order('expires_at', { ascending: false })
      .limit(1);
    if (fps && fps.length) {
      footprintButton = {
        text: `👣 پی‌گرفتن ردِ ${fps[0].user_display} — 2 دقیقه`,
        data: `ticket:footprint:${fps[0].origin_chat_id}:120`
      };
    }
  } catch {}

  const rows = [];
  // 🔥 Relay Candles: چک بوست
  for (const g of gates.slice(0, 24)) {
    let eta = g.base_travel_sec;
    try {
      const { data: c } = await supa
        .from('relay_candles')
        .select('charges_left, expires_at')
        .eq('gate_id', g.id).single();
      if (c && c.charges_left > 0 && new Date(c.expires_at) > new Date()) {
        eta = Math.round(eta * 0.95);
      }
    } catch {}
    const label = `${g.emoji || '🧭'} ${g.label} — ${humanizeSeconds(eta)}`;
    rows.push([Markup.button.callback(label, `ticket:gate:${g.id}:${eta}`)]);
  }

  if (footprintButton) rows.unshift([Markup.button.callback(footprintButton.text, footprintButton.data)]);

  // صفحه‌بندی ساده (در صورت نیاز می‌توان توسعه داد)
  return Markup.inlineKeyboard(rows, { columns: 1 });
}

async function sendArrivalMessage(destChatId, userId) {
  // پیام ورود + منوی مقصدها
  const kb = await buildMenuFor(destChatId, userId);
  const text = '🎴┊وارد شدی؛ هوای اینجا بوی ماجرا می‌دهد...\n\nمسیرهای پیشِ رو:';
  await safeSendMessage(destChatId, text, kb);
}

// ---------- Movement Scheduler ----------
const scheduledJobs = new Map(); // move_id -> timeoutId

async function scheduleArrival(move) {
  const delay = Math.max(0, new Date(move.arrive_at).getTime() - Date.now());
  if (delay > 60 * 60 * 1000) return; // بیش از ۱ ساعت: مدیریت نمی‌کنیم (ساده)
  if (scheduledJobs.has(move.move_id)) return;
  const tid = setTimeout(async () => {
    scheduledJobs.delete(move.move_id);
    try {
      // اعتبارسنجی قبل از ارسال
      const { data: m } = await supa.from('movements')
        .select('state, to_chat_id, user_id')
        .eq('move_id', move.move_id).single();
      if (!m || m.state !== 'scheduled') return;
      await sendArrivalMessage(m.to_chat_id, m.user_id);
      await supa.from('players').update({ status: 'idle', updated_at: nowIso() }).eq('user_id', m.user_id);

      // 👣 ردپا (۲ دقیقه)
      const { data: pl } = await supa.from('players')
        .select('last_chat_id').eq('user_id', m.user_id).single();
      await supa.from('footprints').upsert({
        chat_id: `${m.to_chat_id}`,
        user_id: m.user_id,
        origin_chat_id: pl?.last_chat_id || null,
        user_display: '', // پر نمی‌کنیم؛ در منو از cache/نام فعلی استفاده می‌کنیم
        expires_at: new Date(Date.now() + 120_000).toISOString()
      });

      // 🔥 روشن کردن شمع رله روی gate مربوطه (اگر داشت)
      if (move.gate_id) {
        await supa.from('relay_candles').upsert({
          gate_id: move.gate_id,
          charges_left: 3,
          expires_at: new Date(Date.now() + 300_000).toISOString()
        });
      }

      await supa.from('movements').update({ state: 'arrived' }).eq('move_id', move.move_id);
    } catch (e) {
      // نادیده می‌گیریم؛ دفعه بعد بوت catch-up
    }
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

// ---------- Ticket Flow via Callback ----------
bot.on('callback_query', async (ctx) => {
  try {
    const cb = ctx.callbackQuery;
    const data = cb.data || '';
    const chatId = ctx.chat?.id;
    const userId = cb.from?.id;

    // فقط در گروه‌های ثبت‌شده
    if (!await ensureAllowedChat(chatId)) return ctx.answerCbQuery('منطقه فعال نیست');

    // ticket:gate:<gateId>:<etaSec>
    // ticket:footprint:<origin_chat_id>:<etaSec>
    if (!data.startsWith('ticket:')) return ctx.answerCbQuery();

    let toChatId = null, etaSec = null, gateId = null, label = '';

    if (data.startsWith('ticket:gate:')) {
      const [, , , gId, etaStr] = data.split(':');
      gateId = parseInt(gId, 10);
      etaSec = parseInt(etaStr, 10);
      const { data: g } = await supa.from('gates')
        .select('id, from_chat_id, to_chat_id, base_travel_sec')
        .eq('id', gateId).single();
      if (!g || `${g.from_chat_id}` !== `${chatId}`) return ctx.answerCbQuery('مسیر نامعتبر');
      toChatId = g.to_chat_id;

      // 🔥 مصرف یک شارژ شمع (اتمیک)
      try { await supa.rpc('consume_candle', { p_gate_id: gateId }); } catch {}

    } else if (data.startsWith('ticket:footprint:')) {
      const [, , , originChatId, etaStr] = data.split(':');
      toChatId = originChatId;
      etaSec = parseInt(etaStr, 10);
      gateId = null; // مسیر موقتی
    } else {
      return ctx.answerCbQuery();
    }

    // ساخت بلیت: Invite یک‌بارمصرف
    const link = await createOneTimeInvite(toChatId, userId, gateId || 0, 5 * 60);

    const moveId = newMoveId(userId, gateId || 0);
    const depart = nowIso();
    const arrive = new Date(Date.now() + (etaSec * 1000)).toISOString();

    // ثبت وضعیت بازیکن و حرکت
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

    // حذف نرم از سایر گروه‌ها
    removeFromOtherChats(`${toChatId}`, userId).catch(()=>{});

    // زمان‌بندی پیام ورود
    scheduleArrival({ move_id: moveId, arrive_at: arrive, gate_id: gateId, to_chat_id: toChatId, user_id: userId });

    // لینک بلیت را در PV بده
    try {
      await bot.telegram.sendMessage(userId,
        `🎟️ بلیت مقصد آماده شد.\n\nبرای ورود به منطقه بعدی کلیک کن:`,
        Markup.inlineKeyboard([[Markup.button.url('ورود به مقصد', link.invite_link)]])
      );
      await ctx.answerCbQuery('لینک در پیام‌خصوصی برایت ارسال شد');
    } catch {
      await ctx.answerCbQuery('PV من را استارت کن تا لینک را بفرستم');
      await safeSendMessage(chatId, `[${cb.from.first_name}](tg://user?id=${userId})\nبرای دریافت لینک، PV بات را استارت کن`, { parse_mode: 'Markdown' });
    }

  } catch (e) {
    try { await ctx.answerCbQuery('خطا'); } catch {}
  }
});

// ---------- Approve Join Requests ----------
bot.on('chat_join_request', async (ctx) => {
  try {
    const req = ctx.update.chat_join_request;
    const userId = req.from.id;
    const chatId = `${req.chat.id}`;
    const usedLink = req.invite_link?.invite_link || '';

    // تیکت معتبر؟
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
      // وضعیت بازیکن قبلاً به quarantined@chatId ست شده؛ همین‌جا تضمین دوباره:
      await supa.from('players').upsert({
        user_id: userId,
        current_chat_id: chatId,
        status: 'quarantined',
        updated_at: nowIso()
      }, { onConflict: 'user_id' });
    } else {
      await ctx.declineChatJoinRequest(userId);
    }
  } catch { /* سکوت */ }
});

// ---------- Text Triggers ----------
bot.hears(/^#خروج$/i, async (ctx) => {
  const user = ctx.message?.from;
  if (!user || user.is_bot) return;
  try {
    await ctx.reply(`🧭┊سفر به سلامت ${user.first_name || ''}`, { reply_to_message_id: ctx.message.message_id });
  } catch {}
});

// ---------- Commands ----------
bot.start((ctx) => ctx.reply('نینجا در خدمت شماست 🥷🏻'));

bot.command('on', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`;
  const title = ctx.chat.title || 'بدون عنوان';
  const { error } = await supa.from('registered_chats')
    .upsert({ chat_id: chatId, title, created_at: nowIso() }, { onConflict: 'chat_id' });
  cache.del(`allowed:${chatId}`); cache.del('registered:list');
  if (error) return ctx.reply('❌ خطا در ثبت منطقه');
  ctx.reply('✅ منطقه ثبت شد');
});

bot.command('off', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`;
  await supa.from('registered_chats').delete().eq('chat_id', chatId);
  cache.del(`allowed:${chatId}`); cache.del('registered:list');
  await ctx.reply('✅ منطقه حذف شد؛ ربات گروه را ترک می‌کند…');
  try { await ctx.leaveChat(); } catch {}
});

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

// ساخت دو گِیت رفت/برگشت: /link <from_id> <to_id> <t_forward_sec> <t_back_sec> <label>
bot.command('link', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const parts = (ctx.message.text || '').trim().split(/\s+/);
  if (parts.length < 6) return ctx.reply('فرمت: /link <from> <to> <t_forward> <t_back> <label>');
  const [, fromId, toId, tf, tb, ...lbl] = parts;
  const label = lbl.join(' ');
  const forward = {
    from_chat_id: fromId, to_chat_id: toId,
    label: `${label} (→)`, emoji: '🧭',
    base_travel_sec: parseInt(tf, 10), invite_url: '-', active: true
  };
  const backward = {
    from_chat_id: toId, to_chat_id: fromId,
    label: `${label} (←)`, emoji: '🧭',
    base_travel_sec: parseInt(tb, 10), invite_url: '-', active: true
  };
  const { data: f } = await supa.from('gates').insert(forward).select('id').single();
  const { data: b } = await supa.from('gates').insert(backward).select('id').single();
  if (f?.id && b?.id) {
    await supa.from('gates').update({ inverse_gate_id: b.id }).eq('id', f.id);
    await supa.from('gates').update({ inverse_gate_id: f.id }).eq('id', b.id);
  }
  cache.del(`gates:${fromId}`); cache.del(`gates:${toId}`);
  ctx.reply('✅ لینک‌های رفت/برگشت ساخته شد');
});

// ---------- Ownership-safe joining ----------
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

// ---------- Keep-alive ----------
function startPing() {
  if (!RENDER_URL) return;
  const selfUrl = RENDER_URL;
  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const ping = async () => { try { await axios.head(`${selfUrl}/ping`, { timeout: 5000 }); } catch {} };
  setInterval(ping, PING_INTERVAL);
}
app.get('/ping', (_req, res) => res.status(200).json({ ok: true }));

// ---------- Ephemeral GC ----------
async function gcEphemerals() {
  const ts = nowIso();
  await supa.from('footprints').delete().lt('expires_at', ts);
  await supa.from('relay_candles').delete().lt('expires_at', ts);
}
setInterval(gcEphemerals, 180_000);

// ---------- Server / Webhook ----------
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
