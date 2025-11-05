// ============ Quarantine Bot (index.js) ============
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

// ---------- Env ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const PORT = process.env.PORT || 3000;

const OWNER_ID = parseInt(process.env.OWNER_ID || '0', 10);
const SELF_BOT_ID = process.env.SELF_BOT_ID || 'quarantine_1';
const API_SECRET_KEY = process.env.API_SECRET_KEY || '';

const TABLE_ALLOWED_CHATS = process.env.TABLE_ALLOWED_CHATS || 'registered_chats';
const TABLE_QUARANTINE_USERS = process.env.TABLE_QUARANTINE_USERS || 'quarantine_users';
const TABLE_VIP_USERS = process.env.TABLE_VIP_USERS || 'vip_users';

// ---------- Guards ----------
if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN تنظیم نشده'); process.exit(1); }
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('❌ SUPABASE_URL/SUPABASE_KEY تنظیم نشده'); process.exit(1); }

// ---------- Infra ----------
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

const cache = new NodeCache({ stdTTL: 900, checkperiod: 300, maxKeys: 8000 });

// ---------- Keep-alive ----------
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) return;
  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  const ping = async () => { try { await axios.head(`${selfUrl}/ping`, { timeout: 5000 }); } catch { setTimeout(ping, 60_000); } };
  setTimeout(ping, 30_000); setInterval(ping, PING_INTERVAL);
};
app.head('/ping', (_req, res) => res.status(200).end());
app.get('/ping', (_req, res) => res.status(200).json({ status: 'active', bot: SELF_BOT_ID }));

// ---------- Helpers ----------
const isOwner = (ctx) => (ctx.from?.id === OWNER_ID);
const replyNotOwner = async (ctx) => {
  try { await ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده', { reply_to_message_id: ctx.message?.message_id }); } catch {}
};
const ensureOwner = (ctx) => { if (isOwner(ctx)) return true; replyNotOwner(ctx); return false; };

const isBotAdmin = async (chatId) => {
  try {
    const key = `admin_${chatId}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const meUser = await bot.telegram.getMe();
    const me = await bot.telegram.getChatMember(chatId, meUser.id);
    const ok = ['administrator', 'creator'].includes(me.status);
    cache.set(key, ok, 300);
    return ok;
  } catch { cache.set(`admin_${chatId}`, false, 60); return false; }
};

const isVip = async (userId) => {
  const key = `vip_${userId}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const { data, error } = await supabase.from(TABLE_VIP_USERS).select('user_id').eq('user_id', userId).single();
  const ok = !error && !!data;
  cache.set(key, ok, 600);
  return ok;
};

const setVip = async (userId, yes) => {
  cache.del(`vip_${userId}`);
  if (yes) {
    const { error } = await supabase.from(TABLE_VIP_USERS).upsert({ user_id: userId, added_at: new Date().toISOString() }, { onConflict: 'user_id' });
    return !error;
  } else {
    const { error } = await supabase.from(TABLE_VIP_USERS).delete().eq('user_id', userId);
    return !error;
  }
};

const getUserQuarantineStatus = async (userId) => {
  const key = `user_${userId}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const { data, error } = await supabase
    .from(TABLE_QUARANTINE_USERS)
    .select('is_quarantined, current_chat_id, username, first_name')
    .eq('user_id', userId)
    .single();

  const result = (!error && data)
    ? { isQuarantined: data.is_quarantined, currentChatId: data.current_chat_id, username: data.username, first_name: data.first_name }
    : { isQuarantined: false, currentChatId: null, username: null, first_name: null };

  cache.set(key, result, 600);
  return result;
};

const removeUserFromChat = async (chatId, userId) => {
  try {
    const admin = await isBotAdmin(chatId);
    if (!admin) return false;

    try {
      const m = await bot.telegram.getChatMember(chatId, userId);
      if (['left', 'kicked'].includes(m.status)) return true;
      if (m.status === 'creator') return false;
    } catch { return true; } 

    await bot.telegram.banChatMember(chatId, userId);

    // افزایش زمان آن‌بن (۱۰ ثانیه بیشتر)
    setTimeout(async () => {
      try { await bot.telegram.unbanChatMember(chatId, userId); } catch {}
    }, 10000);  // تاخیر ۱۰ ثانیه برای اطمینان از آن‌بن درست

    return true;
  } catch { return false; }
};

const removeFromOtherChats = async (allowedChatId, userId) => {
  try {
    const key = `allowed_list`;
    let all = cache.get(key);
    if (!all) {
      const { data, error } = await supabase.from(TABLE_ALLOWED_CHATS).select('chat_id, chat_title');
      if (error || !data) return 0;
      all = data; cache.set(key, all, 300);
    }
    let removed = 0;
    for (const c of all) {
      if (`${c.chat_id}` === `${allowedChatId}`) continue;
      const ok = await removeUserFromChat(c.chat_id, userId);
      if (ok) removed++;
    }
    return removed;
  } catch { return 0; }
};

const quarantineUser = async (ctx, user) => {
  const currentChatId = `${ctx.chat.id}`;
  const userId = user.id;

  if (await isVip(userId)) {
    await supabase.from(TABLE_QUARANTINE_USERS).delete().eq('user_id', userId);
    cache.del(`user_${userId}`);
    return true;
  }

  const status = await getUserQuarantineStatus(userId);

  if (status.isQuarantined) {
    if (`${status.currentChatId}` === `${currentChatId}`) return true;
    await removeUserFromChat(currentChatId, userId);
    return false;
  }

  const payload = {
    user_id: userId,
    username: user.username,
    first_name: user.first_name,
    is_quarantined: true,
    current_chat_id: currentChatId,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from(TABLE_QUARANTINE_USERS).upsert(payload, { onConflict: 'user_id' });
  if (error) { console.log('❌ خطا در ذخیره قرنطینه:', error.message); return false; }

  cache.del(`user_${userId}`);
  await removeFromOtherChats(currentChatId, userId);
  return true;
};

// ---------- Commands ----------
bot.start((ctx) => ctx.reply('نینجا در خدمت شماست 🥷🏻'));

bot.command('on', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`;
  const chatTitle = ctx.chat.title || 'بدون عنوان';
  const { error } = await supabase
    .from(TABLE_ALLOWED_CHATS)
    .upsert({ chat_id: chatId, chat_title: chatTitle, created_at: new Date().toISOString() }, { onConflict: 'chat_id' });

  if (error) { console.log('❌ خطا در ثبت منطقه:', error); return ctx.reply('❌ خطا در ثبت منطقه'); }
  cache.del('allowed_list');
  return ctx.reply('✅ منطقه ثبت شد');
});

bot.command('off', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`;
  const { error } = await supabase.from(TABLE_ALLOWED_CHATS).delete().eq('chat_id', chatId);
  if (error) {
    console.log('❌ خطا در حذف منطقه:', error);
    await ctx.reply('⚠️ حذف از دیتابیس انجام نشد، تلاش برای ترک گروه...');
  } else {
    cache.del('allowed_list');
    await ctx.reply('✅ منطقه حذف شد؛ ربات گروه را ترک می‌کند...');
  }
  try { await ctx.leaveChat(); } catch {}
});

// لیست قرنطینه
bot.command('ban_list', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`;
  const { data, error } = await supabase
    .from(TABLE_QUARANTINE_USERS)
    .select('user_id, username, first_name')
    .eq('current_chat_id', chatId)
    .eq('is_quarantined', true)
    .limit(50);

  if (error) return ctx.reply('❌ خطا در دریافت لیست');
  if (!data || data.length === 0) return ctx.reply('لیست قرنطینه فعلاً خالیه ✅');

  const lines = data.map(u => `• ${u.first_name || ''} @${u.username || '-'} (${u.user_id})`).join('\n');
  return ctx.reply(`🧾 لیست قرنطینه (${data.length} نفر):\n${lines}`);
});

// لیست آزادها
bot.command('free_list', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`;
  const { data, error } = await supabase
    .from(TABLE_QUARANTINE_USERS)
    .select('user_id, username, first_name, is_quarantined, current_chat_id')
    .limit(100);

  if (error) return ctx.reply('❌ خطا در دریافت لیست');
  const list = (data || []).filter(u => !u.is_quarantined || `${u.current_chat_id}` !== chatId);
  if (list.length === 0) return ctx.reply('لیست آزادها فعلاً خالیه ✅');

  const lines = list.map(u => `• ${u.first_name || ''} @${u.username || '-'} (${u.user_id})`).join('\n');
  return ctx.reply(`🧾 لیست غیرقرنطینه (${list.length} نفر):\n${lines}`);
});

// VIP / UNVIP با ریپلای
bot.command('vip', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const target = ctx.message?.reply_to_message?.from;
  if (!target) return ctx.reply('روی پیام کاربر ریپلای کن بعد /vip بزن');

  const ok = await setVip(target.id, true);
  if (ok) {
    await supabase.from(TABLE_QUARANTINE_USERS).delete().eq('user_id', target.id);
    cache.del(`user_${target.id}`);
    return ctx.reply(`✅ ${target.first_name} VIP شد و از قرنطینه خارج شد`);
  }
  return ctx.reply('❌ خطا در VIP');
});

bot.command('unvip', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const target = ctx.message?.reply_to_message?.from;
  if (!target) return ctx.reply('روی پیام کاربر ریپلای کن بعد /unvip بزن');

  const ok = await setVip(target.id, false);
  if (ok) return ctx.reply(`✅ ${target.first_name} از VIP حذف شد`);
  return ctx.reply('❌ خطا در حذف VIP');
});

// NEW: آزادسازی با ریپلای
bot.command('free', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const target = ctx.message?.reply_to_message?.from;
  if (!target) return ctx.reply('روی پیام کاربر ریپلای کن بعد /free بزن');

  await supabase.from(TABLE_QUARANTINE_USERS).delete().eq('user_id', target.id);
  cache.del(`user_${target.id}`);
  return ctx.reply(`✅ ${target.first_name} از قرنطینه خارج شد`);
});

// #خروج: ارسال پیام فوری و منشن کاربر
const handleFarewell = async (ctx) => {
  try {
    if (ctx.chat.type === 'private') return;
    const user = ctx.from;
    const displayName = user.first_name || user.username || 'کاربر';
    const mention = `<a href="tg://user?id=${user.id}">${displayName}</a>`;
    const text = `🧭┊سفر به سلامت ${mention}`;
    await ctx.reply(text, { reply_to_message_id: ctx.message.message_id, parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (e) {
    console.log('❌ پیام خروج:', e.message);
  }
};

// ---------- Text pipeline ----------
bot.on('text', async (ctx) => {
  try {
    const text = ctx.message.text || '';

    if (text.includes('#خروج')) {
      await handleFarewell(ctx);
      return;
    }

    if (text.includes('#ورود')) await handleTrigger(ctx, 'ورود');
    if (text.includes('#ماشین')) await handleTrigger(ctx, 'ماشین');
    if (text.includes('#موتور')) await handleTrigger(ctx, 'موتور');

    if (!ctx.session.settingTrigger) return;
    if (!isOwner(ctx)) { await replyNotOwner(ctx); ctx.session.settingTrigger = false; return; }

    if (ctx.session.step === 'delay') {
      const delay = parseInt(text, 10);
      if (isNaN(delay) || delay <= 0 || delay > 3600) return ctx.reply('❌ عدد 1 تا 3600');
      ctx.session.delay = delay; ctx.session.step = 'message';
      return ctx.reply(`✅ زمان: ${formatTime(delay)}\n📝 پیام:`);
    }

    if (ctx.session.step === 'message') {
      try {
        const entities = ctx.message.entities || [];
        await supabase.from('triggers').delete().eq('chat_id', ctx.session.chatId).eq('trigger_type', ctx.session.triggerType);
        const { error } = await supabase.from('triggers').insert({
          chat_id: `${ctx.session.chatId}`,
          trigger_type: ctx.session.triggerType,
          delay: ctx.session.delay,
          delayed_message: text,
          message_entities: entities,
          updated_at: new Date().toISOString()
        });
        if (!error) {
          cache.del(`trigger_${ctx.session.chatId}_${ctx.session.triggerType}`);
          const emoji = ctx.session.triggerType === 'ورود' ? '🚪' : (ctx.session.triggerType === 'ماشین' ? '🚗' : '🏍️');
          await ctx.reply(`${emoji} تریگر #${ctx.session.triggerType} تنظیم شد!`);
        } else { await ctx.reply('❌ خطا در ذخیره تریگر'); }
      } catch { await ctx.reply('❌ خطا در ذخیره'); }
      finally { ctx.session.settingTrigger = false; }
    }
  } catch (e) { console.log('خطا در پردازش پیام:', e.message); }
});

// ---------- Webhook / Launch ----------
app.use(bot.webhookCallback('/webhook'));
app.get('/', (_req, res) => res.send(`<h3>🤖 تریگر ${SELF_BOT_ID}</h3><p>مالک: ${OWNER_ID}</p>`));

app.listen(PORT, async () => {
  console.log(`🚀 تریگر ${SELF_BOT_ID} روی پورت ${PORT}`);
  startAutoPing();
  try {
    if (process.env.RENDER_EXTERNAL_URL) {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
      await bot.telegram.setWebhook(webhookUrl);
      console.log('✅ Webhook:', webhookUrl);
    } else {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      await bot.launch();
      console.log('✅ Long polling launched');
    }
  } catch (e) { console.log('⚠️ startup:', e.message); }
});

process.on('unhandledRejection', (err) => console.log('Unhandled:', (err && err.message) || err));
