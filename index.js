// index.js — Quarantine Bot (hardened + admin cmds + move fix)
require('dotenv').config();

const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const helmet = require('helmet');
const cors = require('cors');

const {
  BOT_TOKEN,
  SUPABASE_URL,
  SUPABASE_KEY,
  OWNER_ID,
  API_SECRET_KEY,
  RENDER_EXTERNAL_URL,
  UNBAN_DELAY_MS,
  PORT
} = process.env;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN لازم است');
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('SUPABASE_URL/SUPABASE_KEY لازم است');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(helmet());
app.use(cors({ origin: false }));

const port = Number(PORT || 3000);
const unbanDelay = Math.max(1000, Number(UNBAN_DELAY_MS || 3000));
const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

let SELF_BOT_ID = null;

// ----- Tables (تنظیم با اسکیمای خودت) -----
const T_CHATS = 'registered_chats';
const T_Q = 'quarantine';
const T_QE = 'quarantine_events';
const T_SP = 'special_users';

// ----- Utils -----
const log = (...a) => console.log('[QB]', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isOwner = (ctx) => OWNER_ID && String(ctx.from?.id) === String(OWNER_ID);

// هندلِ حرکت برای جلوگیری از ریس‌کانDITION
const movingKey = (userId) => `moving_${userId}`;

// ----- Supabase helpers -----
async function upsertChat(chatId, title) {
  try {
    await supabase.from(T_CHATS).upsert(
      { chat_id: chatId, title: title || null, updated_at: new Date().toISOString() },
      { onConflict: 'chat_id' }
    );
  } catch (e) { log('upsertChat err:', e?.message); }
}

async function logEvent(userId, action, by_actor, meta = null) {
  try {
    await supabase.from(T_QE).insert({ user_id: userId, action, by_actor, meta });
  } catch {}
}

async function isSpecial(userId) {
  const { data, error } = await supabase.from(T_SP).select('user_id').eq('user_id', userId).maybeSingle();
  if (error) return false;
  return !!data;
}

async function setSpecial(userId, on, note = null, by_actor = 'owner') {
  if (on) {
    await supabase.from(T_SP).upsert({ user_id: userId, note });
    await logEvent(userId, 'special_on', by_actor, { note });
  } else {
    await supabase.from(T_SP).delete().eq('user_id', userId);
    await logEvent(userId, 'special_off', by_actor, null);
  }
}

async function getQuarantine(userId) {
  const { data, error } = await supabase
    .from(T_Q)
    .select('user_id, allowed_chat_id, is_quarantined')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function setQuarantineAtomic(userId, allowedChatId, is_quarantined = true) {
  const now = new Date().toISOString();
  const payload = {
    user_id: userId,
    allowed_chat_id: allowedChatId || null,
    is_quarantined,
    last_transition_at: now
  };
  if (is_quarantined) {
    payload.created_at = now;
    payload.released_at = null;
  } else {
    payload.released_at = now;
  }
  const { error } = await supabase.from(T_Q).upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
  await logEvent(userId, is_quarantined ? 'quarantine' : 'release', 'system', { allowedChatId });
}

async function releaseQuarantine(userId) {
  await setQuarantineAtomic(userId, null, false);
}

async function listAllChats() {
  const { data, error } = await supabase.from(T_CHATS).select('chat_id');
  if (error) throw error;
  return (data || []).map(r => String(r.chat_id));
}

async function listMembersByQuarantine(isQ, limit = 50, offset = 0) {
  const { data, error } = await supabase
    .from(T_Q)
    .select('user_id, allowed_chat_id, last_transition_at')
    .eq('is_quarantined', isQ)
    .order('last_transition_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data || [];
}

// ----- Admin checks -----
async function isBotAdmin(chatId) {
  try {
    const key = `admin_${chatId}`;
    const cached = cache.get(key);
    if (typeof cached === 'boolean') return cached;
    const admins = await bot.telegram.getChatAdministrators(chatId);
    const ids = admins.map(a => a.user.id);
    const isA = SELF_BOT_ID ? ids.includes(SELF_BOT_ID) : false;
    cache.set(key, isA, 120);
    return isA;
  } catch {
    return false;
  }
}

// ----- Kick helpers -----
async function kickOnce(chatId, userId) {
  try {
    await bot.telegram.banChatMember(chatId, userId);
    await sleep(unbanDelay);
    await bot.telegram.unbanChatMember(chatId, userId);
    await logEvent(userId, 'kick', 'bot', { chatId });
    return true;
  } catch (e) {
    log('kickOnce error:', e?.message);
    return false;
  }
}

async function removeFromOtherChats(allowedChatId, userId) {
  try {
    const all = await listAllChats();
    for (const cid of all) {
      if (String(cid) === String(allowedChatId)) continue; // مهم: هرگز گروه مجاز را نزن
      await kickOnce(cid, userId);
      await sleep(500 + Math.random() * 500);
    }
  } catch (e) {
    log('removeFromOtherChats error:', e?.message);
  }
}

// ----- Access logic -----
async function checkUserAccess({ chatId, userId }) {
  // اگر کاربر ویژه است، کاری نکن
  if (await isSpecial(userId)) return { hasAccess: true, reason: 'special' };

  // اگر قرنطینه است ولی allowed != chatId => در این چت اجازه ندارد
  const q = await getQuarantine(userId);
  if (q?.is_quarantined) {
    if (!q.allowed_chat_id || String(q.allowed_chat_id) !== String(chatId)) {
      return { hasAccess: false, reason: 'quarantined_elsewhere' };
    }
  }
  return { hasAccess: true };
}

/**
 * فلو امن جابجایی به یک گروه جدید (Fix باگ A→B):
 * ۱) اگر special بود: خروج
 * ۲) رکورد قرنطینه را «اتمیک» روی allowed = B ست می‌کنیم (قبل از هر ban)
 * ۳) کمی تأخیر برای settle شدن عضویت در B
 * ۴) حذف از سایر گروه‌ها بجز B
 * ۵) پرچمِ حرکت را پاک می‌کنیم
 */
async function enforceMoveFlow(newChatId, userId) {
  if (await isSpecial(userId)) return;

  // ضد ریس: اگر هم‌زمان دوبار رسید، فقط یکی کار کند
  const key = movingKey(userId);
  if (cache.get(key)) return;
  cache.set(key, true, 10); // اجرای انحصاری ~۱۰ ثانیه

  try {
    // قدم ۲: ست اتمیک allowed = B و is_quarantined = true
    await setQuarantineAtomic(userId, newChatId, true);
    await logEvent(userId, 'move', 'bot', { to: newChatId });

    // قدم ۳: کمی تأخیر (تلگرام گاهی با تأخیر state را پایدار می‌کند)
    await sleep(1500);

    // قدم ۴: حذف از سایر گروه‌ها
    await removeFromOtherChats(newChatId, userId);
  } finally {
    cache.del(key);
  }
}

// ----- Bot middlewares -----
bot.use(async (ctx, next) => {
  const chat = ctx.chat;
  if (chat?.id) {
    upsertChat(chat.id, chat.title || chat.username || null);
  }
  return next();
});

// رویداد تغییر عضو
bot.on('chat_member', async (ctx) => {
  try {
    const cmu = ctx.update.chat_member;
    const chatId = cmu.chat?.id;
    const userId = cmu.new_chat_member?.user?.id;
    if (!chatId || !userId) return;

    const admin = await isBotAdmin(chatId);
    if (!admin) return;

    const oldStatus = cmu.old_chat_member?.status; // left/kicked/member/administrator/restricted
    const newStatus = cmu.new_chat_member?.status;

    // فقط وقتی کاربر واقعا "وارد" شده عمل کن (left→member | left→restricted | kicked→member ...)
    const isJoinEvent =
      (oldStatus === 'left' || oldStatus === 'kicked') &&
      (newStatus === 'member' || newStatus === 'restricted');

    if (isJoinEvent) {
      // Fix حرکت A→B: اول allowed = B، بعد حذف سایر گروه‌ها
      await enforceMoveFlow(chatId, userId);
      return;
    }

    // اگر join نبود، فقط بررسی دسترسی در همین چت (مثلا بوست مجدد state ها)
    const access = await checkUserAccess({ chatId, userId });
    if (!access.hasAccess) {
      // اجازه ندارد در این چت باشد → ban/unban همین چت
      await kickOnce(chatId, userId);
    }
  } catch (e) {
    log('chat_member handler error:', e?.message);
  }
});

// ----- Admin Commands -----

// /member_ban [offset]
bot.command('member_ban', async (ctx) => {
  if (!isOwner(ctx)) return;
  try {
    const parts = (ctx.message.text || '').trim().split(/\s+/);
    const offset = Math.max(0, Number(parts[1] || 0));
    const rows = await listMembersByQuarantine(true, 50, offset);
    if (!rows.length) return ctx.reply('⚪️ فهرست قرنطینه خالی است.');

    const lines = rows.map((r, i) =>
      `${offset + i + 1}. user_id=${r.user_id} | allowed=${r.allowed_chat_id ?? '—'} | at=${r.last_transition_at}`
    );
    await ctx.reply(`🟡 قرنطینه (${rows.length} مورد):\n` + lines.join('\n'));
  } catch (e) {
    await ctx.reply('خطا در دریافت فهرست قرنطینه.');
  }
});

// /member_unban [offset]
bot.command('member_unban', async (ctx) => {
  if (!isOwner(ctx)) return;
  try {
    const parts = (ctx.message.text || '').trim().split(/\s+/);
    const offset = Math.max(0, Number(parts[1] || 0));
    const rows = await listMembersByQuarantine(false, 50, offset);
    if (!rows.length) return ctx.reply('⚪️ کسی خارج از قرنطینه ثبت نشده است.');

    const lines = rows.map((r, i) =>
      `${offset + i + 1}. user_id=${r.user_id} | lastAllowed=${r.allowed_chat_id ?? '—'} | at=${r.last_transition_at}`
    );
    await ctx.reply(`🟢 آزادشده‌ها (${rows.length} مورد):\n` + lines.join('\n'));
  } catch (e) {
    await ctx.reply('خطا در دریافت فهرست آزادشده‌ها.');
  }
});

/**
 * /special <userId>        → toggle (on/off)
 * /special <userId> on     → روشن
 * /special <userId> off    → خاموش
 * /special list [offset]   → نمایش فهرست
 */
bot.command('special', async (ctx) => {
  if (!isOwner(ctx)) return;
  try {
    const args = (ctx.message.text || '').trim().split(/\s+/).slice(1);

    if (!args.length || args[0] === 'help') {
      return ctx.reply(
        'استفاده:\n' +
        '/special <userId>\n' +
        '/special <userId> on|off\n' +
        '/special list [offset]'
      );
    }

    if (args[0] === 'list') {
      const offset = Math.max(0, Number(args[1] || 0));
      const { data, error } = await supabase
        .from(T_SP)
        .select('user_id, note, created_at')
        .order('created_at', { ascending: false })
        .range(offset, offset + 49);
      if (error) throw error;
      if (!data?.length) return ctx.reply('⚪️ لیست ویژه خالی است.');
      const lines = data.map((r, i) =>
        `${offset + i + 1}. user_id=${r.user_id} | note=${r.note ?? '—'} | at=${r.created_at}`
      );
      return ctx.reply(`⭐️ ویژه‌ها (${data.length}):\n` + lines.join('\n'));
    }

    const userId = Number(args[0]);
    if (!Number.isInteger(userId) || userId <= 0) return ctx.reply('userId نامعتبر است.');

    let mode = (args[1] || '').toLowerCase();
    if (!['on', 'off', ''].includes(mode)) mode = '';

    if (!mode) {
      // toggle
      const cur = await isSpecial(userId);
      await setSpecial(userId, !cur, null, 'owner:/special');
      return ctx.reply(`special برای ${userId} → ${!cur ? 'ON' : 'OFF'}`);
    } else {
      const on = mode === 'on';
      await setSpecial(userId, on, null, 'owner:/special');
      return ctx.reply(`special برای ${userId} → ${on ? 'ON' : 'OFF'}`);
    }
  } catch (e) {
    await ctx.reply('خطا در پردازش /special.');
  }
});

// ----- HTTP API -----
app.get('/', (_, res) => res.type('html').send('<h1>🤖 Quarantine bot is up</h1>'));
app.get('/health', (_, res) => res.json({ ok: true }));

const webhookPath = '/webhook';
if (RENDER_EXTERNAL_URL) {
  app.use(webhookPath, (req, res, next) => {
    const token = req.get('X-Telegram-Bot-Api-Secret-Token');
    if (!API_SECRET_KEY || token !== API_SECRET_KEY) return res.sendStatus(401);
    return bot.webhookCallback(webhookPath)(req, res, next);
  });
}

app.post('/api/release-user', async (req, res) => {
  try {
    const { userId, secretKey, sourceBot } = req.body || {};
    if (secretKey !== API_SECRET_KEY) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) return res.status(400).json({ success: false, error: 'Bad userId' });
    await releaseQuarantine(uid);
    return res.json({ success: true, releasedUserId: uid, from: sourceBot || null });
  } catch {
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

app.post('/api/check-quarantine', async (req, res) => {
  try {
    const { userId, secretKey } = req.body || {};
    if (secretKey !== API_SECRET_KEY) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) return res.status(400).json({ success: false, error: 'Bad userId' });
    const q = await getQuarantine(uid);
    return res.json({ success: true, data: q || null });
  } catch {
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ----- Launch -----
(async () => {
  try {
    const me = await bot.telegram.getMe();
    SELF_BOT_ID = me?.id;
    log('Bot username:', me?.username, 'ID:', SELF_BOT_ID);

    if (RENDER_EXTERNAL_URL) {
      const url = `${RENDER_EXTERNAL_URL}${webhookPath}`;
      await bot.telegram.setWebhook(url, { secret_token: API_SECRET_KEY });
      log('Webhook set:', url);
    } else {
      await bot.launch();
      log('Bot started in polling mode');
    }

    app.listen(port, () => log('HTTP listening on', port));
  } catch (e) {
    console.error('Startup error:', e?.message);
    process.exit(1);
  }
})();

process.on('unhandledRejection', (err) => {
  console.error('UnhandledRejection:', err?.message);
});
