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

// جدول‌ها قابل‌تنظیم؛ پیش‌فرض با توجه به خطای شما:
const TABLE_ALLOWED_CHATS = process.env.TABLE_ALLOWED_CHATS || 'registered_chats';
const TABLE_QUARANTINE_USERS = process.env.TABLE_QUARANTINE_USERS || 'quarantine_users';

// ---------- Guards ----------
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN تنظیم نشده');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL/SUPABASE_KEY تنظیم نشده');
  process.exit(1);
}

// ---------- Infra ----------
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

const cache = new NodeCache({
  stdTTL: 900,   // 15m
  checkperiod: 300,
  maxKeys: 5000,
});

// ---------- Keep-alive ping ----------
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) return;
  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000; // ~14 دقیقه
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  const performPing = async () => {
    try { await axios.head(`${selfUrl}/ping`, { timeout: 5000 }); }
    catch { setTimeout(performPing, 60_000); }
  };
  setTimeout(performPing, 30_000);
  setInterval(performPing, PING_INTERVAL);
};

app.head('/ping', (_req, res) => res.status(200).end());
app.get('/ping', (_req, res) => res.status(200).json({ status: 'active', bot: SELF_BOT_ID }));

// ---------- Helpers ----------
const checkOwnerAccess = (ctx) => {
  const userId = ctx.from?.id;
  if (userId !== OWNER_ID) {
    return {
      hasAccess: false,
      message: '🚫 شما مالک اکلیس نیستی ، حق استفاده از بات این مجموعه رو نداری ، حدتو بدون'
    };
  }
  return { hasAccess: true };
};

const isBotAdmin = async (chatId) => {
  try {
    const key = `admin_${chatId}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const me = await bot.telegram.getChatMember(chatId, (await bot.telegram.getMe()).id);
    const ok = ['administrator', 'creator'].includes(me.status);
    cache.set(key, ok, 300);
    return ok;
  } catch (e) {
    cache.set(`admin_${chatId}`, false, 60);
    return false;
  }
};

const getUserQuarantineStatus = async (userId) => {
  const key = `user_${userId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const { data, error } = await supabase
    .from(TABLE_QUARANTINE_USERS)
    .select('is_quarantined, current_chat_id')
    .eq('user_id', userId)
    .single();

  const result = (!error && data)
    ? { isQuarantined: data.is_quarantined, currentChatId: data.current_chat_id }
    : { isQuarantined: false, currentChatId: null };

  cache.set(key, result, 600);
  return result;
};

const removeUserFromChat = async (chatId, userId) => {
  try {
    const admin = await isBotAdmin(chatId);
    if (!admin) {
      console.log(`❌ ربات در ${chatId} ادمین نیست`);
      return false;
    }

    // وضع عضو
    try {
      const m = await bot.telegram.getChatMember(chatId, userId);
      if (['left', 'kicked'].includes(m.status)) return true;
      if (m.status === 'creator') return false;
    } catch {
      // عضو نیست
      return true;
    }

    // حذف با بن + انبن تا محدودیت تلگرام دور زده شود
    await bot.telegram.banChatMember(chatId, userId);
    setTimeout(async () => {
      try { await bot.telegram.unbanChatMember(chatId, userId); } catch {}
    }, 5000);

    return true;
  } catch (e) {
    console.log('❌ خطا در حذف کاربر:', e.message);
    return false;
  }
};

const removeFromOtherChats = async (allowedChatId, userId) => {
  try {
    const key = `allowed_list`;
    let all = cache.get(key);
    if (!all) {
      const { data, error } = await supabase.from(TABLE_ALLOWED_CHATS).select('chat_id, chat_title');
      if (error || !data) return 0;
      all = data;
      cache.set(key, all, 300); // 5m
    }
    let removed = 0;
    for (const c of all) {
      if (`${c.chat_id}` === `${allowedChatId}`) continue;
      const ok = await removeUserFromChat(c.chat_id, userId);
      if (ok) removed++;
    }
    return removed;
  } catch {
    return 0;
  }
};

const quarantineUser = async (ctx, user) => {
  const currentChatId = ctx.chat.id;
  const userId = user.id;

  const status = await getUserQuarantineStatus(userId);

  if (status.isQuarantined) {
    if (`${status.currentChatId}` === `${currentChatId}`) {
      // در گروه خودش است
      return true;
    } else {
      // وارد گروه اشتباه شده؛ حذفش کن از این گروه
      await removeUserFromChat(currentChatId, userId);
      return false;
    }
  }

  // قرنطینه جدید
  const payload = {
    user_id: userId,
    username: user.username,
    first_name: user.first_name,
    is_quarantined: true,
    current_chat_id: currentChatId,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from(TABLE_QUARANTINE_USERS)
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    console.log('❌ خطا در ذخیره قرنطینه:', error.message);
    return false;
  }

  cache.del(`user_${userId}`);
  await removeFromOtherChats(currentChatId, userId);
  return true;
};

// ---------- Commands ----------
bot.start((ctx) => ctx.reply('نینجا در خدمت شماست 🥷🏻'));

bot.command('on', async (ctx) => {
  try {
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) return ctx.reply(access.message);

    const chatId = `${ctx.chat.id}`;
    const chatTitle = ctx.chat.title || 'بدون عنوان';

    const { error } = await supabase
      .from(TABLE_ALLOWED_CHATS)
      .upsert({ chat_id: chatId, chat_title: chatTitle, created_at: new Date().toISOString() }, { onConflict: 'chat_id' });

    if (error) {
      console.log('❌ خطا در ذخیره گروه:', error);
      return ctx.reply('❌ خطا در ثبت منطقه');
    }

    // invalidate cache list
    cache.del('allowed_list');

    return ctx.reply('✅ منطقه ثبت شد');
  } catch (e) {
    ctx.reply('❌ خطا در ثبت منطقه');
  }
});

bot.command('off', async (ctx) => {
  try {
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) return ctx.reply(access.message);

    const chatId = `${ctx.chat.id}`;

    const { error } = await supabase
      .from(TABLE_ALLOWED_CHATS)
      .delete()
      .eq('chat_id', chatId);

    if (error) {
      console.log('❌ خطا در حذف منطقه:', error);
      await ctx.reply('⚠️ حذف از دیتابیس انجام نشد، تلاش برای ترک گروه...');
    } else {
      cache.del('allowed_list');
      await ctx.reply('✅ منطقه حذف شد؛ ربات گروه را ترک می‌کند...');
    }

    // ترک گروه (ممکنه بعد از لفت دیگه نتونه پیام بده، پس پیام رو قبلش دادیم)
    try { await ctx.leaveChat(); } catch (e) { /* ignore */ }
  } catch (e) {
    ctx.reply('❌ خطا در غیرفعال‌سازی');
  }
});

// ---------- New members ----------
bot.on('new_chat_members', async (ctx) => {
  try {
    const chatId = `${ctx.chat.id}`;

    // گروه مجاز؟
    const key = `allowed_${chatId}`;
    let isAllowed = cache.get(key);
    if (isAllowed === undefined) {
      const { data, error } = await supabase
        .from(TABLE_ALLOWED_CHATS)
        .select('chat_id')
        .eq('chat_id', chatId)
        .single();
      isAllowed = !error && !!data;
      cache.set(key, isAllowed, 300);
    }

    if (!isAllowed) {
      console.log('⚠️ گروه در لیست فعال نیست - پردازش نمی‌شود');
      return;
    }

    for (const m of ctx.message.new_chat_members) {
      if (m.is_bot) continue;
      await quarantineUser(ctx, m);
    }
  } catch (e) {
    console.log('❌ خطا در new_chat_members:', e.message);
  }
});

// ---------- Webhook / Launch (یک حالت فعال تا 409 نگیری) ----------
app.use(bot.webhookCallback('/webhook'));
app.get('/', (_req, res) => {
  res.send(`<h3>🤖 قرنطینه ${SELF_BOT_ID}</h3><p>OWNER: ${OWNER_ID}</p>`);
});

app.listen(PORT, async () => {
  console.log(`🚀 قرنطینه ${SELF_BOT_ID} روی پورت ${PORT}`);
  startAutoPing();

  try {
    if (process.env.RENDER_EXTERNAL_URL) {
      // فقط وب‌هوک
      const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
      await bot.telegram.deleteWebhook({ drop_pending_updates: true }); // پاک‌سازی قدیمی
      await bot.telegram.setWebhook(webhookUrl);
      console.log('✅ Webhook تنظیم شد:', webhookUrl);
    } else {
      // فقط لانگ‌پولینگ
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      await bot.launch();
      console.log('✅ Bot launched (long polling)');
    }
  } catch (e) {
    console.log('⚠️ خطا در راه‌اندازی:', e.message);
  }
});

process.on('unhandledRejection', (err) => {
  console.log('خطای catch نشده:', (err && err.message) || err);
});
