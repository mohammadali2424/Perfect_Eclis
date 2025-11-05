// ============ Quarantine Bot (index.js) ============
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

// ---------- Env ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
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
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

const cache = new NodeCache({ stdTTL: 900, checkperiod: 300, maxKeys: 8000 });

// ---------- Keep-alive ping ----------
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) return;
  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  const ping = async () => { try { await axios.head(`${selfUrl}/ping`, { timeout: 5000 }); } catch { setTimeout(ping, 60_000); } };
  setTimeout(ping, 30_000);
  setInterval(ping, PING_INTERVAL);
};
app.head('/ping', (_req, res) => res.status(200).end());
app.get('/ping', (_req, res) => res.status(200).json({ status: 'active', bot: SELF_BOT_ID }));

// ---------- Helpers ----------
const isOwner = (ctx) => (ctx.from?.id === OWNER_ID);
const replyNotOwner = async (ctx) => {
  try { await ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده', { reply_to_message_id: ctx.message?.message_id }); } catch {}
};
const ensureOwner = (ctx) => {
  if (isOwner(ctx)) return true;
  replyNotOwner(ctx);
  return false;
};

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

    // Kick (ban+unban) تا محدودیت تلگرام دور زده شود
    await bot.telegram.banChatMember(chatId, userId);
    setTimeout(async () => { try { await bot.telegram.unbanChatMember(chatId, userId); } catch {} }, 5000);
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

  // اگر VIP باشد، اصلاً قرنطینه نکن
  if (await isVip(userId)) {
    // اگر قبلاً قرنطینه بود، آزادش کن
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

// ---------- Ownership-safe joins ----------
bot.on('my_chat_member', async (ctx) => {
  try {
    const newStatus = ctx.update.my_chat_member?.new_chat_member?.status;
    const adderId = ctx.update.my_chat_member?.from?.id;
    const chatId = ctx.chat?.id;

    if (newStatus && ['member', 'administrator'].includes(newStatus)) {
      if (adderId !== OWNER_ID) {
        try {
          await bot.telegram.sendMessage(chatId,
            'این ربات متعلق به مجموعه اکلیس است ، شما حق استفاده از آنها رو ندارین ، حدتو بدون');
        } catch {}
        try { await bot.telegram.leaveChat(chatId); } catch {}
      }
    }
  } catch (e) { console.log('my_chat_member error:', e.message); }
});

// ---------- Commands ----------
bot.start((ctx) => ctx.reply('نینجا در خدمت شماست 🥷🏻'));

// ثبت گروه
bot.command('on', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`;
  const chatTitle = ctx.chat.title || 'بدون عنوان';
  const { error } = await supabase
    .from(TABLE_ALLOWED_CHATS)
    .upsert({ chat_id: chatId, chat_title: chatTitle, created_at: new Date().toISOString() }, { onConflict: 'chat_id' });

  if (error) { console.log('❌ ثبت منطقه:', error); return ctx.reply('❌ خطا در ثبت منطقه'); }
  cache.del('allowed_list');
  return ctx.reply('✅ منطقه ثبت شد');
});

// حذف گروه + خروج
bot.command('off', async (ctx) => {
  if (!ensureOwner(ctx)) return;
  const chatId = `${ctx.chat.id}`;
  const { error } = await supabase.from(TABLE_ALLOWED_CHATS).delete().eq('chat_id', chatId);
  if (error) { console.log('❌ حذف منطقه:', error); await ctx.reply('⚠️ حذف از دیتابیس انجام نشد، تلاش برای ترک گروه...'); }
  else { cache.del('allowed_list'); await ctx.reply('✅ منطقه حذف شد؛ ربات گروه را ترک می‌کند...'); }
  try { await ctx.leaveChat(); } catch {}
});

// لیست قرنطینه‌ای‌های همین گروه
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

// لیست آزادهای همین گروه (کسانی که رکورد دارند ولی quarantine=false یا current_chat_id همین چت نیست)
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
    // از قرنطینه هم خارجش کن
    await supabase.from(TABLE_QUARANTINE_USERS).delete().eq('user_id', target.id);
    cache.del(`user_${target.id}`);
    return ctx.reply(`✅ ${target.first_name} به VIP اضافه شد و از قرنطینه خارج شد`);
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

// ورود اعضای جدید → قرنطینه
bot.on('new_chat_members', async (ctx) => {
  try {
    const chatId = `${ctx.chat.id}`;
    // فقط گروه‌های فعال
    const key = `allowed_${chatId}`;
    let isAllowed = cache.get(key);
    if (isAllowed === undefined) {
      const { data, error } = await supabase.from(TABLE_ALLOWED_CHATS).select('chat_id').eq('chat_id', chatId).single();
      isAllowed = !error && !!data;
      cache.set(key, isAllowed, 300);
    }
    if (!isAllowed) return;

    for (const m of ctx.message.new_chat_members) {
      if (m.is_bot) continue;
      await quarantineUser(ctx, m);
    }
  } catch (e) { console.log('❌ new_chat_members:', e.message); }
});

// ---------- API: release-user (از ربات تریگر) ----------
app.post('/api/release-user', async (req, res) => {
  try {
    const { userId, secretKey } = req.body || {};
    if (!API_SECRET_KEY || !secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(403).json({ success: false, error: 'forbidden' });
    }
    await supabase.from(TABLE_QUARANTINE_USERS).delete().eq('user_id', userId);
    cache.del(`user_${userId}`);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ---------- Webhook / Launch ----------
app.use(bot.webhookCallback('/webhook'));
app.get('/', (_req, res) => res.send(`<h3>🤖 قرنطینه ${SELF_BOT_ID}</h3><p>مالک: ${OWNER_ID}</p>`));

app.listen(PORT, async () => {
  console.log(`🚀 قرنطینه ${SELF_BOT_ID} روی پورت ${PORT}`);
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
