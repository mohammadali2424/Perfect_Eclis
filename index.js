const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const winston = require('winston');
const cron = require('node-cron');
const NodeCache = require('node-cache');
const helmet = require('helmet');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware امنیتی
app.use(helmet());
app.use(cors());
app.use(express.json());

// ==================[ تنظیمات اولیه ]==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SELF_BOT_ID = process.env.SELF_BOT_ID || 'quarantine_1';
const SYNC_ENABLED = process.env.SYNC_ENABLED === 'true';
const API_SECRET_KEY = process.env.API_SECRET_KEY;
const BOT_INSTANCES = process.env.BOT_INSTANCES ? JSON.parse(process.env.BOT_INSTANCES) : [];
const OWNER_ID = process.env.OWNER_ID;

// کش برای ذخیره وضعیت
const cache = new NodeCache({ stdTTL: 300, checkperiod: 600 });

// ==================[ پینگ خودکار برای جلوگیری از خوابیدن ]==================
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) {
    console.log('🚫 پینگ خودکار غیرفعال (محلی)');
    return;
  }

  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  console.log('🔁 راه‌اندازی پینگ خودکار هر 13:59 دقیقه...');

  const performPing = async () => {
    try {
      console.log('🏓 ارسال پینگ خودکار برای جلوگیری از خوابیدن...');
      const response = await axios.get(`${selfUrl}/ping`, { 
        timeout: 10000 
      });
      console.log('✅ پینگ موفق - ربات فعال می‌ماند');
    } catch (error) {
      console.error('❌ پینگ ناموفق:', error.message);
      setTimeout(performPing, 2 * 60 * 1000);
    }
  };

  setTimeout(performPing, 30000);
  setInterval(performPing, PING_INTERVAL);
};

// endpoint پینگ
app.get('/ping', (req, res) => {
  console.log('🏓 دریافت پینگ - ربات فعال است');
  res.status(200).json({
    status: 'active',
    botId: SELF_BOT_ID,
    timestamp: new Date().toISOString(),
    message: 'ربات قرنطینه فعال و بیدار است 🚀'
  });
});

// ==================[ لاگینگ ]==================
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

// ==================[ تابع بهبود یافته بررسی مالک ]==================
const isOwner = (userId) => {
  if (!OWNER_ID) {
    console.error('❌ OWNER_ID تنظیم نشده است');
    return false;
  }
  
  const userIdStr = userId.toString().trim();
  const ownerIdStr = OWNER_ID.toString().trim();
  
  console.log(`🔍 بررسی مالک: کاربر '${userIdStr}' - مالک '${ownerIdStr}'`);
  
  const result = userIdStr === ownerIdStr;
  return result;
};

// ==================[ توابع کمکی ]==================
const logAction = async (action, userId, chatId = null, details = {}) => {
  try {
    await supabase.from('action_logs').insert({
      action, user_id: userId, chat_id: chatId, details, created_at: new Date().toISOString()
    });
  } catch (error) {
    logger.error('خطا در ثبت فعالیت:', error);
  }
};

// تابع ارسال گزارش به مالک
const sendReportToOwner = async (message) => {
  try {
    await bot.telegram.sendMessage(OWNER_ID, message, {
      parse_mode: 'HTML'
    });
    console.log('✅ گزارش به مالک ارسال شد');
  } catch (error) {
    console.error('❌ خطا در ارسال گزارش به مالک:', error.message);
  }
};

// تابع فرمت‌سازی تاریخ
const formatPersianDate = () => {
  const now = new Date();
  const persianDate = new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(now);
  return persianDate;
};

const isChatAdmin = async (chatId, userId) => {
  try {
    const cacheKey = `admin:${chatId}:${userId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    const member = await bot.telegram.getChatMember(chatId, userId);
    const isAdmin = ['administrator', 'creator'].includes(member.status);
    
    cache.set(cacheKey, isAdmin, 300);
    return isAdmin;
  } catch (error) {
    console.error('❌ خطا در بررسی ادمین:', error);
    return false;
  }
};

const isBotAdmin = async (chatId) => {
  try {
    const cacheKey = `botadmin:${chatId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    const self = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    const isAdmin = ['administrator', 'creator'].includes(self.status);
    
    cache.set(cacheKey, isAdmin, 300);
    return isAdmin;
  } catch (error) {
    console.error('❌ خطا در بررسی ادمین بودن ربات:', error);
    
    if (error.response && error.response.error_code === 403) {
      return false;
    }
    
    return false;
  }
};

const getUserStatus = async (chatId, userId) => {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return member.status;
  } catch (error) {
    if (error.response?.error_code === 400) return 'not_member';
    console.error('❌ خطا در بررسی وضعیت کاربر:', error);
    return null;
  }
};

const removeUserFromChat = async (chatId, userId) => {
  try {
    if (!(await isBotAdmin(chatId))) {
      console.log(`❌ ربات در گروه ${chatId} ادمین نیست، نمی‌تواند کاربر را حذف کند`);
      return false;
    }
    
    const userStatus = await getUserStatus(chatId, userId);
    if (['left', 'kicked', 'not_member'].includes(userStatus)) {
      console.log(`ℹ️ کاربر ${userId} از قبل در گروه ${chatId} نیست`);
      return true;
    }
    
    if (userStatus === 'creator') {
      console.log(`❌ نمی‌توان سازنده گروه ${chatId} را حذف کرد`);
      return false;
    }
    
    console.log(`🗑️ در حال حذف کاربر ${userId} از گروه ${chatId}...`);
    
    await bot.telegram.banChatMember(chatId, userId, {
      until_date: Math.floor(Date.now() / 1000) + 30
    });
    
    await bot.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
    console.log(`✅ کاربر ${userId} از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    if (error.response?.description?.includes("can't remove chat owner")) {
      console.log(`❌ نمی‌توان سازنده گروه ${chatId} را حذف کرد`);
      return false;
    }
    if (error.response?.error_code === 400 && error.response.description?.includes("user not found")) {
      console.log(`ℹ️ کاربر ${userId} در گروه ${chatId} پیدا نشد`);
      return true;
    }
    if (error.response?.error_code === 403) {
      console.log(`❌ ربات در گروه ${chatId} دسترسی ندارد`);
      return false;
    }
    
    console.error(`❌ خطا در حذف کاربر ${userId} از گروه ${chatId}:`, error.message);
    return false;
  }
};

// ==================[ تابع حیاتی: بررسی کاربر در سایر ربات‌های قرنطینه - کاملاً بازنویسی شده ]==================
const checkUserInOtherQuarantineBots = async (userId) => {
  try {
    console.log(`🔍 بررسی کاربر ${userId} در سایر ربات‌های قرنطینه...`);
    
    if (!SYNC_ENABLED || BOT_INSTANCES.length === 0) {
      console.log('🔕 حالت هماهنگی غیرفعال است');
      return { found: false, botId: null, chatId: null, username: null, firstName: null };
    }

    const promises = BOT_INSTANCES
      .filter(botInstance => 
        botInstance.id !== SELF_BOT_ID && 
        botInstance.type === 'quarantine' // فقط ربات‌های قرنطینه
      )
      .map(async (botInstance) => {
        try {
          let apiUrl = botInstance.url;
          if (!apiUrl.startsWith('http')) {
            apiUrl = `https://${apiUrl}`;
          }
          
          apiUrl = apiUrl.replace(/\/$/, '');
          const fullUrl = `${apiUrl}/api/check-quarantine`;
          
          console.log(`🔍 درخواست بررسی کاربر از ${botInstance.id} (${apiUrl})...`);
          
          const response = await axios.post(fullUrl, {
            userId: userId,
            secretKey: botInstance.secretKey || API_SECRET_KEY,
            sourceBot: SELF_BOT_ID
          }, {
            timeout: 10000 // افزایش timeout
          });

          console.log(`📡 پاسخ از ${botInstance.id}:`, response.data);

          if (response.data.isQuarantined) {
            console.log(`⚠️ کاربر ${userId} در ربات ${botInstance.id} قرنطینه است - گروه: ${response.data.currentChatId}`);
            return { 
              found: true, 
              botId: botInstance.id, 
              chatId: response.data.currentChatId,
              username: response.data.username,
              firstName: response.data.firstName
            };
          } else {
            console.log(`✅ کاربر ${userId} در ربات ${botInstance.id} قرنطینه نیست`);
          }
        } catch (error) {
          if (error.code === 'ECONNREFUSED') {
            console.error(`❌ ارتباط با ${botInstance.id} برقرار نشد: سرور در دسترس نیست`);
          } else if (error.response) {
            console.error(`❌ خطا در بررسی کاربر از ${botInstance.id}:`, error.response.status, error.response.data);
          } else if (error.request) {
            console.error(`❌ خطا در بررسی کاربر از ${botInstance.id}: درخواست ارسال شد اما پاسخی دریافت نشد`);
          } else {
            console.error(`❌ خطا در بررسی کاربر از ${botInstance.id}:`, error.message);
          }
        }
        return null;
      });

    const results = await Promise.all(promises);
    const foundResult = results.find(result => result !== null);
    
    if (foundResult) {
      console.log(`🎯 کاربر ${userId} در ربات ${foundResult.botId} پیدا شد`);
    } else {
      console.log(`✅ کاربر ${userId} در هیچ ربات قرنطینه دیگری پیدا نشد`);
    }
    
    return foundResult || { found: false, botId: null, chatId: null, username: null, firstName: null };
  } catch (error) {
    console.error('❌ خطا در بررسی کاربر در سایر ربات‌ها:', error);
    return { found: false, botId: null, chatId: null, username: null, firstName: null };
  }
};

// ==================[ تابع حذف کاربر از گروه‌های این ربات ]==================
const removeUserFromLocalChats = async (userId, exceptChatId = null) => {
  try {
    console.log(`🗑️ در حال حذف کاربر ${userId} از گروه‌های محلی...`);
    
    const { data: allChats, error } = await supabase.from('allowed_chats').select('chat_id, chat_title');
    if (error) {
      console.error('❌ خطا در دریافت گروه‌ها:', error);
      return;
    }
    
    if (allChats && allChats.length > 0) {
      let removedCount = 0;
      for (const chat of allChats) {
        const chatIdStr = chat.chat_id.toString();
        const exceptChatIdStr = exceptChatId ? exceptChatId.toString() : null;
        
        if (!exceptChatIdStr || chatIdStr !== exceptChatIdStr) {
          console.log(`🔍 بررسی حضور کاربر در گروه محلی ${chatIdStr}...`);
          const userStatus = await getUserStatus(chat.chat_id, userId);
          
          if (userStatus && !['left', 'kicked', 'not_member'].includes(userStatus)) {
            console.log(`🚫 کاربر در گروه ${chatIdStr} حضور دارد - در حال حذف...`);
            const removed = await removeUserFromChat(chat.chat_id, userId);
            if (removed) {
              console.log(`✅ کاربر از گروه محلی ${chatIdStr} حذف شد`);
              removedCount++;
            }
          } else {
            console.log(`ℹ️ کاربر از قبل در گروه ${chatIdStr} نیست`);
          }
        }
      }
      console.log(`✅ کاربر ${userId} از ${removedCount} گروه محلی حذف شد`);
    }
  } catch (error) {
    console.error('❌ خطا در حذف کاربر از گروه‌های محلی:', error);
  }
};

// ==================[ تابع اصلی قرنطینه - کاملاً بازنویسی شده ]==================
const quarantineUser = async (ctx, user, isNewJoin = true) => {
  try {
    console.log(`\n🔒 شروع فرآیند قرنطینه برای کاربر: ${user.first_name} (${user.id})`);
    
    const now = new Date().toISOString();
    const userName = user.first_name || 'ناشناس';
    const userUsername = user.username ? `@${user.username}` : 'ندارد';
    const currentChatId = ctx.chat.id.toString();
    const currentChatTitle = ctx.chat.title || 'بدون عنوان';

    // 🔍 مرحله 1: بررسی اینکه کاربر در سایر ربات‌های قرنطینه هست
    console.log(`🔍 مرحله 1: بررسی کاربر در سایر ربات‌های قرنطینه...`);
    const userInOtherBot = await checkUserInOtherQuarantineBots(user.id);
    
    if (userInOtherBot.found) {
      console.log(`🚫 کاربر ${user.id} در ربات ${userInOtherBot.botId} قرنطینه است - حذف از گروه فعلی`);
      
      // حذف فوری کاربر از گروه فعلی
      await removeUserFromChat(currentChatId, user.id);
      
      // ارسال گزارش به مالک
      const reportMessage = `
🚨 **کاربر قرنطینه شده به گروه دیگر پیوست**

👤 کاربر: ${userName} (${user.id})
📱 یوزرنیم: ${userUsername}

📍 گروه مبدا (قرنطینه): ${userInOtherBot.chatId}
🤖 ربات مبدا: ${userInOtherBot.botId}

📍 گروه مقصد: ${currentChatTitle} (${currentChatId})
🤖 ربات مقصد: ${SELF_BOT_ID}

⏰ زمان: ${formatPersianDate()}
      `;
      
      await sendReportToOwner(reportMessage);
      return false; // کاربر قرنطینه شده، اجازه ورود ندارد
    }

    // 🔍 مرحله 2: بررسی وضعیت کاربر در دیتابیس محلی
    console.log(`🔍 مرحله 2: بررسی وضعیت کاربر در دیتابیس محلی...`);
    const { data: existingUser, error: userError } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // اگر کاربر در دیتابیس وجود دارد و در گروه دیگری قرنطینه است
    if (!userError && existingUser && existingUser.is_quarantined && existingUser.current_chat_id !== currentChatId) {
      console.log(`🚫 کاربر در گروه ${existingUser.current_chat_id} قرنطینه است - حذف از گروه فعلی`);
      await removeUserFromChat(currentChatId, user.id);
      return false;
    }

    // 🔒 مرحله 3: ثبت/آپدیت کاربر در قرنطینه
    console.log(`🔒 مرحله 3: ثبت کاربر در قرنطینه...`);
    
    const { error: upsertError } = await supabase.from('quarantine_users').upsert({
      user_id: user.id,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId,
      created_at: existingUser?.created_at || now,
      updated_at: now
    }, { 
      onConflict: 'user_id'
    });

    if (upsertError) {
      console.error('❌ خطا در ثبت کاربر در قرنطینه:', upsertError);
      return false;
    }

    // 🗑️ مرحله 4: حذف کاربر از تمام گروه‌های دیگر این ربات
    console.log(`🗑️ مرحله 4: حذف کاربر از گروه‌های دیگر این ربات...`);
    await removeUserFromLocalChats(user.id, currentChatId);
    
    // 🔄 مرحله 5: هماهنگی با سایر ربات‌های قرنطینه
    if (SYNC_ENABLED) {
      console.log(`🔄 مرحله 5: هماهنگی با سایر ربات‌های قرنطینه...`);
      await syncUserWithOtherBots(user.id, currentChatId, 'quarantine');
    }
    
    await logAction('user_quarantined', user.id, currentChatId, {
      username: user.username, 
      first_name: user.first_name,
      is_new_join: isNewJoin,
      chat_title: currentChatTitle
    });
    
    console.log(`✅ کاربر ${user.id} با موفقیت قرنطینه شد در گروه ${currentChatId}`);
    return true;
    
  } catch (error) {
    console.error('❌ خطا در فرآیند قرنطینه:', error);
    return false;
  }
};

// ==================[ توابع هماهنگی چندرباتی - کاملاً بازنویسی شده ]==================
const syncUserWithOtherBots = async (userId, chatId, action) => {
  try {
    if (!SYNC_ENABLED || BOT_INSTANCES.length === 0) {
      console.log('🔕 حالت هماهنگی غیرفعال است');
      return;
    }

    console.log(`🔄 هماهنگی کاربر ${userId} با سایر ربات‌ها برای عمل: ${action}...`);
    
    const promises = BOT_INSTANCES
      .filter(botInstance => 
        botInstance.id !== SELF_BOT_ID && 
        botInstance.type === 'quarantine' // فقط با ربات‌های قرنطینه هماهنگ شو
      )
      .map(async (botInstance) => {
        try {
          let apiUrl = botInstance.url;
          if (!apiUrl.startsWith('http')) {
            apiUrl = `https://${apiUrl}`;
          }
          
          apiUrl = apiUrl.replace(/\/$/, '');
          const fullUrl = `${apiUrl}/api/sync-user`;
          
          console.log(`🔗 ارسال درخواست به ${botInstance.id} (${apiUrl})...`);
          
          const response = await axios.post(fullUrl, {
            userId: userId,
            chatId: chatId,
            action: action,
            secretKey: botInstance.secretKey || API_SECRET_KEY,
            sourceBot: SELF_BOT_ID
          }, {
            timeout: 10000
          });
          
          console.log(`✅ هماهنگی با ${botInstance.id} موفق:`, response.data);
        } catch (error) {
          if (error.code === 'ECONNREFUSED') {
            console.error(`❌ ارتباط با ${botInstance.id} برقرار نشد: سرور در دسترس نیست`);
          } else if (error.response) {
            console.error(`❌ هماهنگی با ${botInstance.id} ناموفق:`, error.response.status, error.response.data);
          } else if (error.request) {
            console.error(`❌ هماهنگی با ${botInstance.id} ناموفق: درخواست ارسال شد اما پاسخی دریافت نشد`);
          } else {
            console.error(`❌ هماهنگی با ${botInstance.id} ناموفق:`, error.message);
          }
        }
      });

    await Promise.all(promises);
    console.log(`✅ هماهنگی کاربر ${userId} برای عمل ${action} تکمیل شد`);
  } catch (error) {
    console.error('❌ خطا در هماهنگی با ربات‌ها:', error);
  }
};

// ==================[ تابع آزادسازی کاربر از قرنطینه ]==================
const releaseUserFromQuarantine = async (userId) => {
  try {
    console.log(`🔄 در حال آزاد کردن کاربر ${userId} از قرنطینه...`);
    
    // آپدیت وضعیت کاربر در دیتابیس
    const { error: updateError } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);
      
    if (updateError) {
      console.error(`❌ خطا در خارج کردن کاربر ${userId} از قرنطینه:`, updateError);
      return false;
    }
    
    // پاک کردن کش کاربر
    cache.del(`quarantine:${userId}`);
    
    // هماهنگی با سایر ربات‌ها
    if (SYNC_ENABLED) {
      await syncUserWithOtherBots(userId, null, 'release');
    }
    
    console.log(`✅ کاربر ${userId} با موفقیت از قرنطینه خارج شد`);
    return true;
  } catch (error) {
    console.error(`❌ خطا در آزادسازی کاربر ${userId}:`, error);
    return false;
  }
};

// ==================[ تابع بررسی انقضای قرنطینه ]==================
const checkQuarantineExpiry = async () => {
  try {
    console.log('🔍 بررسی انقضای قرنطینه کاربران...');
    
    const { data: expiredUsers, error } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('is_quarantined', true)
      .lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    
    if (error) {
      console.error('❌ خطا در دریافت کاربران منقضی:', error);
      return;
    }
    
    if (expiredUsers && expiredUsers.length > 0) {
      console.log(`📅 پیدا شد ${expiredUsers.length} کاربر برای آزادسازی از قرنطینه`);
      
      for (const user of expiredUsers) {
        console.log(`🔄 آزادسازی کاربر ${user.user_id} از قرنطینه...`);
        
        const success = await releaseUserFromQuarantine(user.user_id);
        if (success) {
          // گزارش به مالک
          const reportMessage = `
🟢 **کاربر از قرنطینه خارج شد**

👤 کاربر: ${user.first_name || 'ناشناس'} (${user.user_id})
📱 یوزرنیم: ${user.username ? `@${user.username}` : 'ندارد'}

⏰ زمان انقضا: ${formatPersianDate()}
🤖 ربات: ${SELF_BOT_ID}

📝 توضیح: کاربر به صورت خودکار پس از اتمام زمان قرنطینه آزاد شد.
          `;
          
          await sendReportToOwner(reportMessage);
          await logAction('quarantine_expired', user.user_id, null, {
            username: user.username, 
            first_name: user.first_name,
            auto_released: true
          });
        }
      }
    } else {
      console.log('ℹ️ هیچ کاربری برای آزادسازی از قرنطینه پیدا نشد');
    }
  } catch (error) {
    console.error('❌ خطا در بررسی انقضای قرنطینه:', error);
  }
};

// ==================[ بررسی دسترسی کاربر - فقط مالک ]==================
const checkUserAccess = async (ctx) => {
  try {
    // فقط مالک ربات دسترسی دارد
    if (isOwner(ctx.from.id)) {
      return { hasAccess: true, isOwner: true };
    }

    return { hasAccess: false, reason: 'شما دسترسی لازم را ندارید' };
  } catch (error) {
    console.error('❌ خطا در بررسی دسترسی:', error);
    return { hasAccess: false, reason: 'خطا در بررسی دسترسی' };
  }
};

// ==================[ پردازش اعضای جدید ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    console.log(`\n🆕 اعضای جدید به گروه ${ctx.chat.id} اضافه شدند`);
    
    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        console.log(`👤 کاربر عادی اضافه شد: ${member.first_name} (${member.id})`);
        await quarantineUser(ctx, member, true);
      }
    }
  } catch (error) {
    console.error('❌ خطا در پردازش عضو جدید:', error);
  }
});

// ==================[ endpointهای API - حیاتی ]==================
app.post('/api/check-quarantine', async (req, res) => {
  try {
    const { userId, secretKey, sourceBot } = req.body;
    
    // بررسی کلید امنیتی
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      console.warn('❌ درخواست غیرمجاز برای بررسی قرنطینه کاربر');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    console.log(`🔍 دریافت درخواست بررسی قرنطینه کاربر ${userId} از ${sourceBot || 'unknown'}`);
    
    // بررسی وضعیت کاربر در دیتابیس
    const { data: user, error } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', userId)
      .single();
      
    if (error || !user) {
      return res.status(200).json({ 
        isQuarantined: false,
        botId: SELF_BOT_ID,
        note: 'کاربر در این ربات قرنطینه نیست'
      });
    }
    
    res.status(200).json({ 
      isQuarantined: user.is_quarantined,
      currentChatId: user.current_chat_id,
      username: user.username,
      firstName: user.first_name,
      botId: SELF_BOT_ID,
      note: user.is_quarantined ? 'کاربر در این ربات قرنطینه است' : 'کاربر در این ربات آزاد است'
    });
  } catch (error) {
    console.error('❌ خطا در endpoint بررسی قرنطینه:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/sync-user', async (req, res) => {
  try {
    const { userId, chatId, action, secretKey, sourceBot } = req.body;
    
    // بررسی کلید امنیتی
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log(`🔄 درخواست هماهنگی از ${sourceBot} برای کاربر ${userId} - عمل: ${action}`);
    
    if (action === 'quarantine') {
      // قرنطینه کردن کاربر در این ربات
      await supabase
        .from('quarantine_users')
        .upsert({
          user_id: userId,
          is_quarantined: true,
          current_chat_id: chatId,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        
      console.log(`✅ کاربر ${userId} در این ربات قرنطینه شد (هماهنگی از ${sourceBot})`);
      
    } else if (action === 'release') {
      // آزاد کردن کاربر
      await releaseUserFromQuarantine(userId);
      console.log(`✅ کاربر ${userId} از این ربات آزاد شد (هماهنگی از ${sourceBot})`);
    }
    
    res.status(200).json({
      success: true,
      botId: SELF_BOT_ID,
      processed: true,
      message: `User ${userId} synced for action: ${action}`
    });
  } catch (error) {
    console.error('❌ خطا در پردازش هماهنگی:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/release-user', async (req, res) => {
  try {
    const { userId, secretKey, sourceBot } = req.body;
    
    // بررسی کلید امنیتی
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      console.warn('❌ درخواست غیرمجاز برای آزادسازی کاربر');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    console.log(`🔓 درخواست API آزادسازی کاربر ${userId} از ${sourceBot || 'unknown'}`);
    
    const success = await releaseUserFromQuarantine(userId);
    
    if (success) {
      console.log(`✅ کاربر ${userId} از طریق API از قرنطینه خارج شد`);
      res.status(200).json({ 
        success: true,
        botId: SELF_BOT_ID,
        message: `User ${userId} released from quarantine`
      });
    } else {
      console.log(`❌ خطا در آزادسازی کاربر ${userId} از طریق API`);
      res.status(500).json({ 
        success: false,
        error: 'Failed to release user from quarantine'
      });
    }
  } catch (error) {
    console.error('❌ خطا در endpoint آزاد کردن کاربر:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/bot-status', (req, res) => {
  res.status(200).json({
    status: 'online',
    botId: SELF_BOT_ID,
    type: 'quarantine',
    timestamp: new Date().toISOString(),
    connectedBots: BOT_INSTANCES.length,
    version: '3.3.0'
  });
});

// ==================[ راه‌اندازی سرور ]==================
app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => res.send('ربات قرنطینه فعال است!'));
app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

app.listen(PORT, () => {
  console.log(`\n✅ سرور ربات قرنطینه ${SELF_BOT_ID} روی پورت ${PORT} راه‌اندازی شد`);
  console.log(`🤖 شناسه ربات: ${SELF_BOT_ID}`);
  console.log(`🔗 حالت هماهنگی: ${SYNC_ENABLED ? 'فعال' : 'غیرفعال'}`);
  console.log(`👥 تعداد ربات‌های متصل: ${BOT_INSTANCES.length}`);
  console.log(`🏥 ربات‌های قرنطینه: ${BOT_INSTANCES.filter(bot => bot.type === 'quarantine').length}`);
  console.log(`⚡ ربات‌های تریگر: ${BOT_INSTANCES.filter(bot => bot.type === 'trigger').length}`);
  console.log(`👑 مالک ربات: ${OWNER_ID}`);
  
  // شروع پینگ خودکار
  startAutoPing();
});

// بررسی انقضای قرنطینه هر 6 ساعت
cron.schedule('0 */6 * * *', () => checkQuarantineExpiry());

// فعال سازی وب هوک
if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => console.log(`✅ Webhook تنظیم شد: ${webhookUrl}`))
    .catch(error => {
      console.error('❌ خطا در تنظیم Webhook:', error);
      console.log('🔄 استفاده از Long Polling...');
      bot.launch().then(() => {
        console.log('✅ ربات با Long Polling راه‌اندازی شد');
      });
    });
} else {
  console.log('🔄 استفاده از Long Polling...');
  bot.launch().then(() => {
    console.log('✅ ربات با Long Polling راه‌اندازی شد');
  });
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = app;
