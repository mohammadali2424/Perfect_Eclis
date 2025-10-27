const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ==================[ تنظیمات ]==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SELF_BOT_ID = process.env.SELF_BOT_ID || 'quarantine_1';
const OWNER_ID = parseInt(process.env.OWNER_ID) || 0;
const API_SECRET_KEY = process.env.API_SECRET_KEY;

const cache = new NodeCache({ 
  stdTTL: 900, // کاهش زمان کش
  checkperiod: 300,
  maxKeys: 5000,
  useClones: false
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

// ==================[ پینگ ]==================
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) return;
  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  const performPing = async () => {
    try {
      await axios.head(`${selfUrl}/ping`, { timeout: 5000 });
    } catch (error) {
      setTimeout(performPing, 60000);
    }
  };

  setTimeout(performPing, 30000);
  setInterval(performPing, PING_INTERVAL);
};

app.head('/ping', (req, res) => res.status(200).end());
app.get('/ping', (req, res) => {
  res.status(200).json({ status: 'active', bot: SELF_BOT_ID });
});

// ==================[ توابع اصلی - کاملاً اصلاح شده ]==================

const checkOwnerAccess = (ctx) => {
  const userId = ctx.from.id;
  if (userId !== OWNER_ID) {
    return {
      hasAccess: false,
      message: '🚫 شما مالک اکلیس نیستی ، حق استفاده از بات این مجموعه رو نداری ، حدتو بدون'
    };
  }
  return { hasAccess: true };
};

// تابع بررسی ادمین بودن ربات - بهبود یافته
const isBotAdmin = async (chatId) => {
  try {
    const cacheKey = `admin_${chatId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const chatMember = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    const isAdmin = ['administrator', 'creator'].includes(chatMember.status);
    
    cache.set(cacheKey, isAdmin, 300); // کاهش زمان کش
    return isAdmin;
  } catch (error) {
    console.log(`❌ خطا در بررسی ادمین:`, error.message);
    cache.set(`admin_${chatId}`, false, 60);
    return false;
  }
};

// تابع حذف کاربر از گروه - بهبود یافته
const removeUserFromChat = async (chatId, userId) => {
  try {
    const adminStatus = await isBotAdmin(chatId);
    if (!adminStatus) {
      console.log(`❌ ربات در گروه ${chatId} ادمین نیست`);
      return false;
    }

    // بررسی وضعیت کاربر
    let userStatus;
    try {
      const member = await bot.telegram.getChatMember(chatId, userId);
      userStatus = member.status;
    } catch (error) {
      console.log(`✅ کاربر ${userId} از قبل در گروه نیست`);
      return true;
    }

    if (['left', 'kicked'].includes(userStatus)) {
      console.log(`✅ کاربر ${userId} از قبل حذف شده`);
      return true;
    }
    
    if (userStatus === 'creator') {
      console.log(`❌ کاربر ${userId} سازنده گروه است`);
      return false;
    }

    // حذف کاربر
    await bot.telegram.banChatMember(chatId, userId);
    setTimeout(async () => {
      try {
        await bot.telegram.unbanChatMember(chatId, userId);
      } catch (error) {
        // ignore unban errors
      }
    }, 1000);
    
    console.log(`✅ کاربر ${userId} از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    console.log(`❌ خطا در حذف کاربر:`, error.message);
    return false;
  }
};

// بررسی وضعیت کاربر - بهبود یافته
const getUserQuarantineStatus = async (userId) => {
  try {
    const cacheKey = `user_${userId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const { data, error } = await supabase
      .from('quarantine_users')
      .select('is_quarantined, current_chat_id')
      .eq('user_id', userId)
      .single();

    const result = data ? {
      isQuarantined: data.is_quarantined,
      currentChatId: data.current_chat_id
    } : { isQuarantined: false, currentChatId: null };

    cache.set(cacheKey, result, 600); // کاهش زمان کش
    return result;
  } catch (error) {
    console.log(`❌ خطا در دریافت وضعیت کاربر:`, error.message);
    return { isQuarantined: false, currentChatId: null };
  }
};

// تابع آزادسازی کاربر - کاملاً بازنویسی شده
const releaseUserFromQuarantine = async (userId) => {
  try {
    console.log(`🔓 شروع آزادسازی کاربر ${userId}`);

    // ابتدا وضعیت فعلی را بررسی کن
    const currentStatus = await getUserQuarantineStatus(userId);
    
    if (!currentStatus.isQuarantined) {
      console.log(`✅ کاربر ${userId} از قبل آزاد است`);
      return true;
    }

    // به‌روزرسانی دیتابیس در یک تراکنش
    const { error } = await supabase
      .from('quarantine_users')
      .update({
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) {
      console.log('❌ خطا در به‌روزرسانی دیتابیس:', error);
      return false;
    }

    // پاک کردن تمام کش‌های مرتبط
    cache.del(`user_${userId}`);
    cache.del(`user_quarantine_${userId}`);
    
    // پاک کردن کش گروه‌ها
    const { data: userChats } = await supabase
      .from('allowed_chats')
      .select('chat_id');
    
    if (userChats) {
      userChats.forEach(chat => {
        cache.del(`admin_${chat.chat_id}`);
      });
    }

    console.log(`✅ کاربر ${userId} با موفقیت آزاد شد`);
    return true;

  } catch (error) {
    console.log(`❌ خطا در آزادسازی کاربر ${userId}:`, error);
    return false;
  }
};

// ==================[ API های کاملاً اصلاح شده ]==================
app.post('/api/release-user', async (req, res) => {
  try {
    const { userId, secretKey, sourceBot } = req.body;
    
    console.log('📨 دریافت درخواست آزادسازی:', { userId, sourceBot });
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized'
      });
    }
    
    if (!userId) {
      return res.status(400).json({ 
        success: false,
        error: 'Bad Request'
      });
    }
    
    // پاسخ فوری به درخواست
    res.status(200).json({ 
      success: true,
      botId: SELF_BOT_ID,
      message: 'درخواست آزادسازی دریافت شد'
    });

    // پردازش آزادسازی در پس‌زمینه
    setTimeout(async () => {
      try {
        console.log(`🔓 پردازش آزادسازی کاربر ${userId}...`);
        const result = await releaseUserFromQuarantine(userId);
        console.log(`📊 نتیجه آزادسازی کاربر ${userId}:`, result);
      } catch (error) {
        console.log(`❌ خطا در پردازش آزادسازی:`, error);
      }
    }, 100);
    
  } catch (error) {
    console.log('❌ خطا در endpoint آزادسازی:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error'
    });
  }
});

app.post('/api/check-quarantine', async (req, res) => {
  try {
    const { userId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const status = await getUserQuarantineStatus(userId);
    
    res.status(200).json({
      isQuarantined: status.isQuarantined,
      currentChatId: status.currentChatId,
      botId: SELF_BOT_ID
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================[ دستور جدید برای آزادسازی کاربر ]==================
bot.command('free_user', async (ctx) => {
  try {
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    const messageText = ctx.message.text;
    const userIdMatch = messageText.match(/\d+/);
    
    if (!userIdMatch) {
      return ctx.reply('❌ لطفاً آیدی کاربر را وارد کنید: /free_user 123456789');
    }

    const userId = parseInt(userIdMatch[0]);
    console.log(`🔓 درخواست آزادسازی دستی کاربر ${userId} توسط مالک...`);

    const result = await releaseUserFromQuarantine(userId);
    
    if (result) {
      await ctx.reply(`✅ کاربر ${userId} با موفقیت آزاد شد.`);
    } else {
      await ctx.reply(`❌ خطا در آزادسازی کاربر ${userId}.`);
    }
  } catch (error) {
    console.log('❌ خطا در دستور آزادسازی:', error);
    await ctx.reply('❌ خطا در پردازش درخواست.');
  }
});

// ==================[ دستور برای بررسی وضعیت کاربر ]==================
bot.command('check_user', async (ctx) => {
  try {
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    const messageText = ctx.message.text;
    const userIdMatch = messageText.match(/\d+/);
    
    if (!userIdMatch) {
      return ctx.reply('❌ لطفاً آیدی کاربر را وارد کنید: /check_user 123456789');
    }

    const userId = parseInt(userIdMatch[0]);
    const status = await getUserQuarantineStatus(userId);
    
    await ctx.reply(
      `📊 وضعیت کاربر ${userId}:\n` +
      `🔒 قرنطینه: ${status.isQuarantined ? '✅ بله' : '❌ خیر'}\n` +
      `💬 گروه فعلی: ${status.currentChatId || 'ندارد'}`
    );
  } catch (error) {
    console.log('❌ خطا در دستور بررسی:', error);
    await ctx.reply('❌ خطا در بررسی وضعیت.');
  }
});

// بقیه کدها مانند قبل...
// [کدهای پردازش اعضای جدید و دستورات on/off/status مانند قبل]

// ==================[ راه‌اندازی سرور ]==================
app.use(bot.webhookCallback('/webhook'));

app.get('/', (req, res) => {
  res.send(`🤖 ربات قرنطینه ${SELF_BOT_ID} - فعال و بهبود یافته`);
});

app.listen(PORT, () => {
  console.log(`🚀 ربات قرنطینه ${SELF_BOT_ID} راه‌اندازی شد`);
  startAutoPing();
});

if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => console.log('✅ Webhook تنظیم شد'))
    .catch(error => {
      console.log('❌ خطا در تنظیم Webhook:', error.message);
      bot.launch();
    });
} else {
  bot.launch();
}

process.on('unhandledRejection', (error) => {
  console.log('❌ خطای catch نشده:', error.message);
});
