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
  stdTTL: 1800,
  checkperiod: 900,
  maxKeys: 3000
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

// ==================[ پینگ 13:59 دقیقه ]==================
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

// تابع بررسی مالکیت - کاملاً اصلاح شده
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

// تابع بررسی ادمین بودن ربات - کاملاً اصلاح شده
const isBotAdmin = async (chatId) => {
  try {
    const cacheKey = `admin_${chatId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      console.log(`🔍 وضعیت ادمین از کش: ${cached} برای گروه ${chatId}`);
      return cached;
    }

    console.log(`🔍 بررسی وضعیت ادمین ربات در گروه ${chatId}...`);
    
    // استفاده از getChatAdministrators برای بررسی دقیق‌تر
    const admins = await bot.telegram.getChatAdministrators(chatId);
    const botAdmin = admins.find(admin => admin.user.id === bot.botInfo.id);
    
    const isAdmin = !!botAdmin;
    console.log(`🤖 ربات در گروه ${chatId} ادمین است: ${isAdmin}`);
    
    cache.set(cacheKey, isAdmin, 600); // کش برای 10 دقیقه
    return isAdmin;
  } catch (error) {
    console.log(`❌ خطا در بررسی ادمین بودن ربات در گروه ${chatId}:`, error.message);
    cache.set(`admin_${chatId}`, false, 300); // کش خطا برای 5 دقیقه
    return false;
  }
};

const removeUserFromChat = async (chatId, userId) => {
  try {
    const adminStatus = await isBotAdmin(chatId);
    if (!adminStatus) {
      console.log(`❌ ربات در گروه ${chatId} ادمین نیست - امکان حذف کاربر وجود ندارد`);
      return false;
    }

    console.log(`🔍 بررسی وضعیت کاربر ${userId} در گروه ${chatId}...`);
    
    let userStatus;
    try {
      const member = await bot.telegram.getChatMember(chatId, userId);
      userStatus = member.status;
      console.log(`📊 وضعیت کاربر ${userId} در گروه: ${userStatus}`);
    } catch (error) {
      console.log(`⚠️ کاربر ${userId} در گروه ${chatId} یافت نشد`);
      return true; // کاربر در گروه نیست
    }

    if (['left', 'kicked', 'not_member'].includes(userStatus)) {
      console.log(`✅ کاربر ${userId} از قبل در گروه نیست`);
      return true;
    }
    
    if (userStatus === 'creator') {
      console.log(`❌ کاربر ${userId} سازنده گروه است - امکان حذف نیست`);
      return false;
    }

    console.log(`🗑️ حذف کاربر ${userId} از گروه ${chatId}...`);
    
    // استفاده از ban و unban برای اطمینان از حذف
    await bot.telegram.banChatMember(chatId, userId, {
      until_date: Math.floor(Date.now() / 1000) + 35
    });
    
    // آنبن کردن برای امکان پیوستن مجدد در آینده
    await bot.telegram.unbanChatMember(chatId, userId, { 
      only_if_banned: true 
    });
    
    console.log(`✅ کاربر ${userId} از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    console.log(`❌ خطا در حذف کاربر ${userId} از گروه ${chatId}:`, error.message);
    return false;
  }
};

// بررسی وضعیت کاربر از دیتابیس مرکزی - اصلاح شده
const getUserQuarantineStatus = async (userId) => {
  try {
    const cacheKey = `user_${userId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    console.log(`🔍 بررسی وضعیت قرنطینه کاربر ${userId} از دیتابیس...`);
    
    const { data, error } = await supabase
      .from('quarantine_users')
      .select('is_quarantined, current_chat_id')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.log(`📊 کاربر ${userId} در دیتابیس یافت نشد`);
      return { isQuarantined: false, currentChatId: null };
    }

    const result = data ? {
      isQuarantined: data.is_quarantined,
      currentChatId: data.current_chat_id
    } : { isQuarantined: false, currentChatId: null };

    console.log(`📋 وضعیت کاربر ${userId}:`, result);
    
    cache.set(cacheKey, result, 900);
    return result;
  } catch (error) {
    console.log(`❌ خطا در دریافت وضعیت کاربر ${userId}:`, error.message);
    return { isQuarantined: false, currentChatId: null };
  }
};

// حذف کاربر از تمام گروه‌های غیرمجاز - اصلاح شده
const removeFromOtherChats = async (allowedChatId, userId) => {
  try {
    console.log(`🔍 شروع حذف کاربر ${userId} از گروه‌های غیرمجاز...`);
    
    const { data: allChats, error } = await supabase
      .from('allowed_chats')
      .select('chat_id, chat_title');

    if (error || !allChats) {
      console.log('❌ خطا در دریافت لیست گروه‌های مجاز');
      return 0;
    }

    console.log(`📋 تعداد گروه‌های مجاز: ${allChats.length}`);
    
    let removedCount = 0;
    for (const chat of allChats) {
      if (chat.chat_id.toString() === allowedChatId.toString()) {
        console.log(`✅ گروه ${chat.chat_title} گروه مجاز کاربر است - حذف نمی‌شود`);
        continue;
      }

      console.log(`🔍 بررسی حذف کاربر از گروه ${chat.chat_title}...`);
      const removed = await removeUserFromChat(chat.chat_id, userId);
      if (removed) {
        removedCount++;
        console.log(`✅ کاربر ${userId} از گروه ${chat.chat_title} حذف شد`);
      } else {
        console.log(`⚠️ کاربر ${userId} از گروه ${chat.chat_title} حذف نشد`);
      }
    }

    console.log(`🎯 کاربر ${userId} از ${removedCount} گروه حذف شد`);
    return removedCount;
  } catch (error) {
    console.log('❌ خطا در حذف از گروه‌های دیگر:', error.message);
    return 0;
  }
};

// تابع اصلی قرنطینه - کاملاً اصلاح شده
const quarantineUser = async (ctx, user) => {
  try {
    const currentChatId = ctx.chat.id.toString();
    const userId = user.id;

    console.log(`🔍 شروع فرآیند قرنطینه برای کاربر ${userId} در گروه ${currentChatId}`);

    // بررسی وضعیت کاربر در دیتابیس مرکزی
    const status = await getUserQuarantineStatus(userId);

    if (status.isQuarantined) {
      if (status.currentChatId === currentChatId) {
        console.log(`✅ کاربر ${userId} در گروه مجاز خودش هست`);
        return true;
      } else {
        console.log(`🚫 کاربر ${userId} در گروه اشتباهی هست - حذف کردن`);
        await removeUserFromChat(currentChatId, userId);
        return false;
      }
    }

    // کاربر جدید - قرنطینه کردن
    console.log(`🔒 قرنطینه کردن کاربر جدید ${userId} در گروه ${currentChatId}`);

    const userData = {
      user_id: userId,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('quarantine_users')
      .upsert(userData, { onConflict: 'user_id' });

    if (error) {
      console.log('❌ خطا در ذخیره کاربر در دیتابیس:', error);
      return false;
    }

    // پاک کردن کش کاربر
    cache.del(`user_${userId}`);

    // حذف از گروه‌های دیگر
    const removedCount = await removeFromOtherChats(currentChatId, userId);

    console.log(`✅ کاربر ${userId} با موفقیت در دیتابیس مرکزی قرنطینه شد`);
    console.log(`🗑️ از ${removedCount} گروه دیگر حذف شد`);
    
    return true;

  } catch (error) {
    console.log('❌ خطا در فرآیند قرنطینه:', error);
    return false;
  }
};

// تابع آزادسازی کاربر - کاملاً اصلاح شده
const releaseUserFromQuarantine = async (userId) => {
  try {
    console.log(`🔓 شروع فرآیند آزادسازی کاربر ${userId} از قرنطینه`);

    // ابتدا وضعیت فعلی کاربر را بررسی می‌کنیم
    const currentStatus = await getUserQuarantineStatus(userId);
    console.log(`📊 وضعیت فعلی کاربر ${userId}:`, currentStatus);

    if (!currentStatus.isQuarantined) {
      console.log(`⚠️ کاربر ${userId} از قبل در قرنطینه نیست`);
      return true;
    }

    // به روزرسانی دیتابیس مرکزی
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

    // پاک کردن کش - این قسمت حیاتی است
    cache.del(`user_${userId}`);
    
    console.log(`✅ کاربر ${userId} از قرنطینه مرکزی آزاد شد`);
    return true;

  } catch (error) {
    console.log(`❌ خطا در آزادسازی کاربر ${userId}:`, error);
    return false;
  }
};

// ==================[ پردازش اعضای جدید - کاملاً اصلاح شده ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    console.log('👥 دریافت عضو جدید در گروه');

    // اگر ربات اضافه شده باشد
    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot && member.id === ctx.botInfo.id) {
        const addedBy = ctx.message.from;
        
        // بررسی مالکیت - کاملاً اصلاح شده
        if (addedBy.id !== OWNER_ID) {
          console.log(`🚫 کاربر ${addedBy.id} مالک نیست - لفت دادن از گروه`);
          await ctx.reply('🚫 شما مالک اکلیس نیستی ، حق استفاده از بات این مجموعه رو نداری ، حدتو بدون');
          await ctx.leaveChat();
          return;
        }
        
        console.log(`✅ ربات توسط مالک ${addedBy.id} اضافه شد`);
        await ctx.reply('✅ ربات با موفقیت اضافه شد! از /on برای فعال‌سازی استفاده کنید.');
        return;
      }
    }

    // بررسی اینکه گروه فعال هست
    const chatId = ctx.chat.id.toString();
    const { data: allowedChat } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (!allowedChat) {
      console.log('⚠️ گروه در لیست فعال نیست - پردازش کاربران جدید انجام نمی‌شود');
      return;
    }

    console.log('✅ گروه فعال است - پردازش کاربران جدید...');

    // پردازش کاربران عادی
    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        console.log(`🔍 پردازش کاربر ${member.id} (${member.first_name})`);
        await quarantineUser(ctx, member);
      }
    }

  } catch (error) {
    console.log('❌ خطا در پردازش عضو جدید:', error);
  }
});

// ==================[ API های اصلاح شده ]==================
app.post('/api/release-user', async (req, res) => {
  try {
    const { userId, secretKey, sourceBot } = req.body;
    
    console.log('📨 دریافت درخواست آزادسازی کاربر:', { userId, sourceBot });
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      console.log('❌ کلید API نامعتبر است');
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized',
        message: 'کلید API نامعتبر است'
      });
    }
    
    if (!userId) {
      console.log('❌ شناسه کاربر ارائه نشده');
      return res.status(400).json({ 
        success: false,
        error: 'Bad Request',
        message: 'شناسه کاربر الزامی است'
      });
    }
    
    console.log(`🔓 درخواست آزادسازی کاربر ${userId} از ${sourceBot || 'نامشخص'}`);
    
    const result = await releaseUserFromQuarantine(userId);
    
    console.log(`📋 نتیجه آزادسازی کاربر ${userId}:`, result);
    
    res.status(200).json({ 
      success: result,
      botId: SELF_BOT_ID,
      message: result ? `کاربر ${userId} آزاد شد` : `خطا در آزادسازی کاربر ${userId}`
    });
  } catch (error) {
    console.log('❌ خطا در endpoint آزادسازی:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: error.message
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

// ==================[ دستورات مدیریتی - کاملاً اصلاح شده ]==================
bot.command('on', async (ctx) => {
  try {
    // بررسی مالکیت
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      ctx.reply(access.message);
      return;
    }

    const chatId = ctx.chat.id.toString();
    const chatTitle = ctx.chat.title || 'بدون عنوان';

    console.log(`🔧 درخواست فعال‌سازی ربات در گروه ${chatTitle} (${chatId})`);

    // بررسی ادمین بودن ربات - با مدیریت خطا بهتر
    let isAdmin;
    try {
      isAdmin = await isBotAdmin(chatId);
    } catch (error) {
      console.log('❌ خطا در بررسی ادمین:', error);
      isAdmin = false;
    }

    if (!isAdmin) {
      console.log(`❌ ربات در گروه ${chatTitle} ادمین نیست`);
      ctx.reply('❌ لطفاً ابتدا ربات را ادمین گروه کنید و سپس مجدداً /on را ارسال کنید.');
      return;
    }

    console.log(`✅ ربات در گروه ${chatTitle} ادمین است - ادامه فرآیند فعال‌سازی`);

    // افزودن گروه به دیتابیس مرکزی
    const chatData = {
      chat_id: chatId,
      chat_title: chatTitle,
      created_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('allowed_chats')
      .upsert(chatData, { onConflict: 'chat_id' });

    if (error) {
      console.log('❌ خطا در ذخیره گروه در دیتابیس:', error);
      throw error;
    }

    // پاک کردن کش گروه‌ها
    cache.del('allowed_chats_list');

    ctx.reply('✅ ربات با موفقیت فعال شد! کاربران جدید به طور خودکار قرنطینه می‌شوند.');
    console.log(`✅ گروه ${chatTitle} (${chatId}) توسط مالک فعال شد`);

  } catch (error) {
    console.log('❌ خطا در فعال‌سازی گروه:', error);
    ctx.reply('❌ خطا در فعال‌سازی گروه. لطفاً دوباره تلاش کنید.');
  }
});

bot.command('off', async (ctx) => {
  try {
    // بررسی مالکیت
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      ctx.reply(access.message);
      return;
    }

    const chatId = ctx.chat.id.toString();

    console.log(`🔧 درخواست غیرفعال‌سازی ربات از گروه ${chatId}`);

    // حذف گروه از دیتابیس مرکزی
    const { error } = await supabase
      .from('allowed_chats')
      .delete()
      .eq('chat_id', chatId);

    if (error) {
      console.log('❌ خطا در حذف گروه از دیتابیس:', error);
      throw error;
    }

    // پاک کردن کش
    cache.del('allowed_chats_list');
    cache.del(`admin_${chatId}`);

    ctx.reply('✅ ربات با موفقیت غیرفعال شد!');

    // خروج از گروه
    try {
      await ctx.leaveChat();
      console.log(`🚪 ربات از گروه ${chatId} خارج شد`);
    } catch (leaveError) {
      console.log('⚠️ خطا در خروج از گروه:', leaveError.message);
    }

  } catch (error) {
    console.log('❌ خطا در غیرفعال کردن ربات:', error);
    ctx.reply('❌ خطایی در غیرفعال کردن ربات رخ داد.');
  }
});

bot.command('status', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  
  const { data: allowedChat } = await supabase
    .from('allowed_chats')
    .select('chat_id')
    .eq('chat_id', chatId)
    .single();

  if (allowedChat) {
    ctx.reply('✅ ربات در این گروه فعال است.');
  } else {
    ctx.reply('❌ ربات در این گروه غیرفعال است.');
  }
});

// ==================[ راه‌اندازی سرور ]==================
app.use(bot.webhookCallback('/webhook'));

app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 ربات قرنطینه ${SELF_BOT_ID}</h1>
    <p>ربات فعال است - فقط مالک می‌تواند استفاده کند</p>
    <p>مالک: ${OWNER_ID}</p>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 ربات قرنطینه ${SELF_BOT_ID} راه‌اندازی شد`);
  console.log(`👤 مالک ربات: ${OWNER_ID}`);
  console.log(`🔑 کلید API: ${API_SECRET_KEY ? 'تنظیم شده' : 'تنظیم نشده'}`);
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

// مدیریت خطاها
process.on('unhandledRejection', (error) => {
  console.log('❌ خطای catch نشده:', error.message);
});

process.on('uncaughtException', (error) => {
  console.log('❌ خطای مدیریت نشده:', error);
});
