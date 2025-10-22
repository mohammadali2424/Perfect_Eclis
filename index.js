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
const OWNER_ID = process.env.OWNER_ID; // فقط از این متغیر استفاده می‌شود

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
  console.log(`✅ نتیجه بررسی مالک: ${result}`);
  return result;
};

// ==================[ محدودیت نرخ درخواست ]==================
const rateLimit = new Map();
const checkRateLimit = (userId, action, limit = 5, windowMs = 60000) => {
  const key = `${userId}:${action}`;
  const now = Date.now();
  const userLimits = rateLimit.get(key) || [];
  const recentLimits = userLimits.filter(time => now - time < windowMs);
  
  if (recentLimits.length >= limit) return false;
  
  recentLimits.push(now);
  rateLimit.set(key, recentLimits);
  return true;
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
    if (['not_member', 'left', 'kicked'].includes(userStatus)) {
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

// ==================[ تابع اصلی و حیاتی: حذف کاربر از تمام گروه‌های دیگر ]==================
const removeUserFromAllOtherChats = async (currentChatId, userId, userName = 'ناشناس') => {
  try {
    console.log(`🔍 در حال بررسی حذف کاربر ${userId} از گروه‌های دیگر به جز ${currentChatId}...`);
    
    const { data: allChats, error } = await supabase.from('allowed_chats').select('chat_id, chat_title');
    if (error) {
      console.error('❌ خطا در دریافت گروه‌ها:', error);
      return;
    }
    
    if (allChats && allChats.length > 0) {
      console.log(`📋 پیدا شد ${allChats.length} گروه فعال`);
      
      let removedCount = 0;
      let sourceChatTitle = '';
      
      for (const chat of allChats) {
        const chatIdStr = chat.chat_id.toString();
        const currentChatIdStr = currentChatId.toString();
        
        if (chatIdStr === currentChatIdStr) {
          sourceChatTitle = chat.chat_title || 'بدون عنوان';
          continue;
        }
        
        console.log(`🗑️ در حال بررسی حذف کاربر از گروه ${chatIdStr}...`);
        const userStatus = await getUserStatus(chat.chat_id, userId);
        
        if (userStatus && !['left', 'kicked', 'not_member'].includes(userStatus)) {
          console.log(`🚫 کاربر در گروه ${chatIdStr} حضور دارد - در حال حذف...`);
          const removed = await removeUserFromChat(chat.chat_id, userId);
          if (removed) {
            console.log(`✅ کاربر از گروه ${chatIdStr} حذف شد`);
            removedCount++;
            
            // ارسال گزارش تخلف قرنطینه
            const reportMessage = `
🚨 **گزارش تخلف قرنطینه**

👤 کاربر: ${userName} (${userId})
📋 نوع تخلف: کاربر قرنطینه شده از گروه خارج نشده و به گروه جدید پیوسته است

📍 گروه مبدا: ${sourceChatTitle} (${currentChatId})
📍 گروه مقصد: ${chat.chat_title || 'بدون عنوان'} (${chat.chat_id})

⏰ زمان: ${formatPersianDate()}
🤖 ربات گزارش‌دهنده: ${SELF_BOT_ID}
            `;
            
            await sendReportToOwner(reportMessage);
          }
        } else {
          console.log(`ℹ️ کاربر از قبل در گروه ${chatIdStr} نیست`);
        }
      }
      console.log(`✅ کاربر ${userId} از ${removedCount} گروه دیگر حذف شد`);
    } else {
      console.log('ℹ️ هیچ گروه فعالی پیدا نشد');
    }
  } catch (error) {
    console.error('❌ خطا در حذف کاربر از گروه‌های دیگر:', error);
  }
};

// ==================[ تابع بررسی کاربر در سایر ربات‌ها - بهبود یافته ]==================
const checkUserInOtherBots = async (userId) => {
  try {
    console.log(`🔍 بررسی کاربر ${userId} در سایر ربات‌ها...`);
    
    if (!SYNC_ENABLED || BOT_INSTANCES.length === 0) {
      console.log('🔕 حالت هماهنگی غیرفعال است');
      return { found: false, botId: null, chatId: null, username: null, firstName: null };
    }

    const promises = BOT_INSTANCES
      .filter(botInstance => botInstance.id !== SELF_BOT_ID)
      .map(async (botInstance) => {
        try {
          let apiUrl = botInstance.url;
          if (!apiUrl.startsWith('http')) {
            apiUrl = `https://${apiUrl}`;
          }
          
          apiUrl = apiUrl.replace(/\/$/, '');
          const fullUrl = `${apiUrl}/api/check-quarantine`;
          
          console.log(`🔍 درخواست بررسی کاربر از ${botInstance.id}...`);
          
          const response = await axios.post(fullUrl, {
            userId: userId,
            secretKey: API_SECRET_KEY,
            sourceBot: SELF_BOT_ID
          }, {
            timeout: 8000
          });

          if (response.data.isQuarantined) {
            console.log(`⚠️ کاربر ${userId} در ربات ${botInstance.id} قرنطینه است - گروه: ${response.data.currentChatId}`);
            return { 
              found: true, 
              botId: botInstance.id, 
              chatId: response.data.currentChatId,
              username: response.data.username,
              firstName: response.data.firstName
            };
          }
        } catch (error) {
          console.error(`❌ خطا در بررسی کاربر از ${botInstance.id}:`, error.message);
        }
        return null;
      });

    const results = await Promise.all(promises);
    const foundResult = results.find(result => result !== null);
    
    return foundResult || { found: false, botId: null, chatId: null, username: null, firstName: null };
  } catch (error) {
    console.error('❌ خطا در بررسی کاربر در سایر ربات‌ها:', error);
    return { found: false, botId: null, chatId: null, username: null, firstName: null };
  }
};

// ==================[ تابع حذف کاربر از گروه‌های این ربات - بهبود یافته ]==================
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
          console.log(`🗑️ در حال حذف کاربر از گروه محلی ${chatIdStr}...`);
          const userStatus = await getUserStatus(chat.chat_id, userId);
          
          if (userStatus && !['left', 'kicked', 'not_member'].includes(userStatus)) {
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
    console.log(`🔒 شروع فرآیند قرنطینه برای کاربر: ${user.first_name} (${user.id})`);
    
    const now = new Date().toISOString();
    const userName = user.first_name || 'ناشناس';
    const userUsername = user.username ? `@${user.username}` : 'ندارد';
    const currentChatId = ctx.chat.id.toString();

    // 🔍 مرحله 1: بررسی اینکه کاربر در سایر ربات‌ها قرنطینه است
    if (SYNC_ENABLED) {
      console.log(`🔍 بررسی کاربر ${user.id} در سایر ربات‌ها...`);
      const userInOtherBot = await checkUserInOtherBots(user.id);
      
      if (userInOtherBot.found) {
        console.log(`🚫 کاربر ${user.id} در ربات ${userInOtherBot.botId} قرنطینه است`);
        
        // حذف فوری کاربر از گروه فعلی
        await removeUserFromChat(currentChatId, user.id);
        
        // ارسال گزارش به مالک
        const reportMessage = `
🚨 **کاربر قرنطینه شده به گروه دیگر پیوست**

👤 کاربر: ${userName} (${user.id})
📱 یوزرنیم: ${userUsername}

📍 گروه مبدا (قرنطینه): ${userInOtherBot.chatId}
🤖 ربات مبدا: ${userInOtherBot.botId}

📍 گروه مقصد: ${ctx.chat.title} (${ctx.chat.id})
🤖 ربات مقصد: ${SELF_BOT_ID}

⏰ زمان: ${formatPersianDate()}
        `;
        
        await sendReportToOwner(reportMessage);
        return false; // کاربر قرنطینه شده، اجازه ورود ندارد
      }
    }

    // 🔍 مرحله 2: بررسی وضعیت کاربر در دیتابیس محلی
    const { data: existingUser, error: userError } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', user.id)
      .single();

    let shouldQuarantine = true;
    let currentQuarantineChatId = currentChatId;

    if (!userError && existingUser) {
      // کاربر در دیتابیس وجود دارد
      if (existingUser.is_quarantined && existingUser.current_chat_id) {
        if (existingUser.current_chat_id !== currentChatId) {
          // کاربر در گروه دیگری قرنطینه است
          console.log(`🚫 کاربر در گروه ${existingUser.current_chat_id} قرنطینه است - حذف از گروه فعلی`);
          await removeUserFromChat(currentChatId, user.id);
          currentQuarantineChatId = existingUser.current_chat_id;
          shouldQuarantine = false;
        } else {
          // کاربر در همین گروه قرنطینه است - فقط اطلاعات را آپدیت کن
          console.log(`📝 کاربر در همین گروه قرنطینه است - آپدیت اطلاعات`);
        }
      } else {
        // کاربر قبلاً آزاد شده بود - قرنطینه مجدد
        console.log(`🔄 کاربر آزاد - قرنطینه مجدد در گروه ${currentChatId}`);
      }
    } else {
      // کاربر جدید است
      console.log(`🆕 کاربر جدید - ثبت در قرنطینه`);
    }

    if (shouldQuarantine) {
      // 🔒 مرحله 3: ثبت/آپدیت کاربر در قرنطینه
      const { error: upsertError } = await supabase.from('quarantine_users').upsert({
        user_id: user.id,
        username: user.username,
        first_name: user.first_name,
        is_quarantined: true,
        current_chat_id: currentQuarantineChatId,
        created_at: existingUser?.created_at || now,
        updated_at: now
      }, { onConflict: 'user_id' });

      if (upsertError) {
        console.error('❌ خطا در ثبت کاربر در قرنطینه:', upsertError);
        return false;
      }

      // 🗑️ مرحله 4: حذف کاربر از تمام گروه‌های دیگر (هم محلی و هم در ربات‌های دیگر)
      console.log(`🔄 در حال حذف کاربر از گروه‌های دیگر...`);
      
      // حذف از گروه‌های محلی دیگر
      await removeUserFromAllOtherChats(currentQuarantineChatId, user.id, userName);
      
      // 🔄 مرحله 5: هماهنگی با سایر ربات‌ها
      if (SYNC_ENABLED) {
        console.log(`🔄 هماهنگی کاربر با سایر ربات‌ها...`);
        await syncUserWithOtherBots(user.id, currentQuarantineChatId, 'quarantine');
      }
      
      await logAction('user_quarantined', user.id, currentQuarantineChatId, {
        username: user.username, 
        first_name: user.first_name,
        is_new_join: isNewJoin
      });
      
      console.log(`✅ کاربر ${user.id} با موفقیت قرنطینه شد در گروه ${currentQuarantineChatId}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('❌ خطا در فرآیند قرنطینه:', error);
    return false;
  }
};

// ==================[ تابع جدید: بررسی و حذف کاربر از گروه‌های دیگر بدون در نظر گرفتن قرنطینه ]==================
const ensureUserInSingleChat = async (ctx, user) => {
  try {
    console.log(`🔍 بررسی حضور کاربر ${user.id} در گروه‌های دیگر...`);
    
    const currentChatId = ctx.chat.id.toString();
    const userName = user.first_name || 'ناشناس';
    
    // بررسی وضعیت کاربر در دیتابیس
    const { data: existingUser, error: userError } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // اگر کاربر قرنطینه نیست، باز هم بررسی کن که در گروه‌های دیگر نباشد
    if (!userError && existingUser && !existingUser.is_quarantined) {
      console.log(`👤 کاربر ${user.id} قرنطینه نیست - بررسی حضور در گروه‌های دیگر`);
      
      const { data: allChats, error } = await supabase.from('allowed_chats').select('chat_id, chat_title');
      if (error) {
        console.error('❌ خطا در دریافت گروه‌ها:', error);
        return;
      }
      
      if (allChats && allChats.length > 0) {
        let removedCount = 0;
        
        for (const chat of allChats) {
          const chatIdStr = chat.chat_id.toString();
          const currentChatIdStr = currentChatId.toString();
          
          if (chatIdStr === currentChatIdStr) continue;
          
          console.log(`🔍 بررسی حضور کاربر در گروه ${chatIdStr}...`);
          const userStatus = await getUserStatus(chat.chat_id, user.id);
          
          if (userStatus && !['left', 'kicked', 'not_member'].includes(userStatus)) {
            console.log(`🚫 کاربر در گروه ${chatIdStr} حضور دارد - در حال حذف...`);
            const removed = await removeUserFromChat(chat.chat_id, user.id);
            if (removed) {
              console.log(`✅ کاربر از گروه ${chatIdStr} حذف شد`);
              removedCount++;
              
              // ارسال گزارش
              const reportMessage = `
⚠️ **کاربر از گروه دیگر حذف شد**

👤 کاربر: ${userName} (${user.id})
📱 یوزرنیم: ${user.username ? `@${user.username}` : 'ندارد'}

📍 گروه مبدا: ${chat.chat_title || 'بدون عنوان'} (${chat.chat_id})
📍 گروه مقصد: ${ctx.chat.title} (${ctx.chat.id})

⏰ زمان: ${formatPersianDate()}
🤖 ربات: ${SELF_BOT_ID}

📝 توضیح: کاربر در گروه‌های متعدد شناسایی و از گروه‌های دیگر حذف شد
              `;
              
              await sendReportToOwner(reportMessage);
            }
          }
        }
        
        if (removedCount > 0) {
          console.log(`✅ کاربر ${user.id} از ${removedCount} گروه دیگر حذف شد`);
          
          // آپدیت وضعیت کاربر به قرنطینه در گروه جدید
          await supabase
            .from('quarantine_users')
            .update({
              is_quarantined: true,
              current_chat_id: currentChatId,
              updated_at: new Date().toISOString()
            })
            .eq('user_id', user.id);
          
          // هماهنگی با سایر ربات‌ها
          if (SYNC_ENABLED) {
            await syncUserWithOtherBots(user.id, currentChatId, 'quarantine');
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ خطا در بررسی تک گروهی کاربر:', error);
  }
};

// ==================[ پردازش اعضای جدید - کاملاً بازنویسی شده ]==================
const handleNewUser = async (ctx, user) => {
  try {
    console.log(`👤 پردازش کاربر جدید: ${user.first_name} (${user.id}) در گروه ${ctx.chat.id}`);
    
    // بررسی اینکه گروه فعال است یا نه
    const { data: allowedChat, error: chatError } = await supabase
      .from('allowed_chats')
      .select('chat_id, chat_title')
      .eq('chat_id', ctx.chat.id.toString())
      .single();

    if (chatError || !allowedChat) {
      console.log('ℹ️ گروه فعال نیست، کاربر قرنطینه نمی‌شود');
      return;
    }

    // 🔍 اول: بررسی حضور کاربر در گروه‌های دیگر (حتی اگر قرنطینه نباشد)
    await ensureUserInSingleChat(ctx, user);
    
    // 🔒 دوم: اجرای فرآیند قرنطینه معمول
    await quarantineUser(ctx, user, true);
  } catch (error) {
    console.error('❌ خطا در پردازش کاربر جدید:', error);
  }
};

// ==================[ توابع هماهنگی چندرباتی - بهبود یافته ]==================
const syncUserWithOtherBots = async (userId, chatId, action) => {
  try {
    if (!SYNC_ENABLED || BOT_INSTANCES.length === 0) {
      console.log('🔕 حالت هماهنگی غیرفعال است');
      return;
    }

    console.log(`🔄 هماهنگی کاربر ${userId} با سایر ربات‌ها برای عمل: ${action}...`);
    
    const promises = BOT_INSTANCES
      .filter(botInstance => botInstance.id !== SELF_BOT_ID)
      .map(async (botInstance) => {
        try {
          let apiUrl = botInstance.url;
          if (!apiUrl.startsWith('http')) {
            apiUrl = `https://${apiUrl}`;
          }
          
          apiUrl = apiUrl.replace(/\/$/, '');
          const fullUrl = `${apiUrl}/api/sync-user`;
          
          console.log(`🔗 ارسال درخواست به ${botInstance.id}...`);
          
          await axios.post(fullUrl, {
            userId: userId,
            chatId: chatId,
            action: action,
            secretKey: API_SECRET_KEY,
            sourceBot: SELF_BOT_ID
          }, {
            timeout: 10000
          });
          
          console.log(`✅ هماهنگی با ${botInstance.id} موفق`);
        } catch (error) {
          console.error(`❌ هماهنگی با ${botInstance.id} ناموفق:`, error.message);
        }
      });

    await Promise.all(promises);
    console.log(`✅ هماهنگی کاربر ${userId} برای عمل ${action} تکمیل شد`);
  } catch (error) {
    console.error('❌ خطا در هماهنگی با ربات‌ها:', error);
  }
};

// ==================[ تابع بررسی انقضای قرنطینه - بهبود یافته ]==================
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
        
        const { error: updateError } = await supabase
          .from('quarantine_users')
          .update({ 
            is_quarantined: false, 
            current_chat_id: null, 
            updated_at: new Date().toISOString() 
          })
          .eq('user_id', user.user_id);
          
        if (updateError) {
          console.error(`❌ خطا در آزادسازی کاربر ${user.user_id}:`, updateError);
          continue;
        }
        
        // پاک کردن کش
        cache.del(`quarantine:${user.user_id}`);
        
        // هماهنگی با سایر ربات‌ها
        if (SYNC_ENABLED) {
          await syncUserWithOtherBots(user.user_id, null, 'release');
        }
        
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
        
        console.log(`✅ کاربر ${user.user_id} با موفقیت از قرنطینه آزاد شد`);
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

// ==================[ دستورات ربات - فقط برای مالک ]==================
bot.start((ctx) => {
  if (!checkRateLimit(ctx.from.id, 'start')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  ctx.reply('ناظر اکلیس در خدمت شماست 🥷🏻');
  logAction('bot_started', ctx.from.id);
});

// دستور فعال‌سازی گروه - فقط برای مالک
bot.command('on', async (ctx) => {
  if (!ctx.message.chat.type.includes('group')) {
    ctx.reply('این دستور فقط در گروه‌ها قابل استفاده است.');
    return;
  }

  const chatId = ctx.chat.id.toString();
  const userId = ctx.message.from.id;

  if (!checkRateLimit(userId, 'activate')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }

  // فقط مالک می‌تواند استفاده کند
  const userAccess = await checkUserAccess(ctx);
  if (!userAccess.hasAccess) {
    ctx.reply(`❌ ${userAccess.reason}`);
    return;
  }

  // بررسی ادمین بودن ربات
  const botIsAdmin = await isBotAdmin(chatId);
  console.log(`🔍 بررسی ادمین بودن ربات در گروه ${chatId}: ${botIsAdmin}`);
  
  if (!botIsAdmin) {
    ctx.reply('❌ لطفاً ابتدا ربات را ادمین گروه کنید.');
    return;
  }

  try {
    // بررسی اینکه گروه قبلاً فعال شده یا نه
    const { data: existingChat, error: checkError } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (existingChat) {
      ctx.reply('✅ ربات قبلاً در این گروه فعال شده است.');
      return;
    }

    // فعال‌سازی گروه
    const { error } = await supabase
      .from('allowed_chats')
      .insert({
        chat_id: chatId,
        chat_title: ctx.chat.title,
        created_at: new Date().toISOString()
      });

    if (error) {
      console.error('❌ خطا در فعال‌سازی گروه:', error);
      ctx.reply('❌ خطا در فعال‌سازی گروه.');
      return;
    }

    ctx.reply('✅ ربات با موفقیت فعال شد! از این پس کاربران جدید قرنطینه خواهند شد.');
    
    // ارسال گزارش به مالک
    const reportMessage = `
🟢 **ربات در گروه جدید فعال شد**

🏠 گروه: ${ctx.chat.title}
🆔 آیدی: ${ctx.chat.id}

👤 فعال‌کننده: ${ctx.from.first_name} ${ctx.from.last_name || ''} (${ctx.from.username ? `@${ctx.from.username}` : 'بدون یوزرنیم'})
🆔 آیدی کاربر: ${ctx.from.id}

⏰ زمان: ${formatPersianDate()}
    `;
    
    await sendReportToOwner(reportMessage);
    await logAction('chat_activated', userId, chatId, {
      chat_title: ctx.chat.title
    });
  } catch (error) {
    console.error('❌ خطا در فعال‌سازی گروه:', error);
    ctx.reply('❌ خطا در فعال‌سازی گروه.');
  }
});

// دستور غیرفعال‌سازی گروه - فقط برای مالک
bot.command('off', async (ctx) => {
  if (!ctx.message.chat.type.includes('group')) {
    ctx.reply('این دستور فقط در گروه‌ها قابل استفاده است.');
    return;
  }

  const chatId = ctx.chat.id.toString();
  const userId = ctx.message.from.id;

  if (!checkRateLimit(userId, 'deactivate')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }

  // فقط مالک می‌تواند استفاده کند
  const userAccess = await checkUserAccess(ctx);
  if (!userAccess.hasAccess) {
    ctx.reply(`❌ ${userAccess.reason}`);
    return;
  }

  try {
    // بررسی اینکه گروه فعال است یا نه
    const { data: existingChat, error: checkError } = await supabase
      .from('allowed_chats')
      .select('chat_id, chat_title')
      .eq('chat_id', chatId)
      .single();

    if (!existingChat) {
      ctx.reply('ℹ️ ربات در این گروه از قبل غیرفعال است.');
      return;
    }

    // غیرفعال‌سازی گروه
    const { error } = await supabase
      .from('allowed_chats')
      .delete()
      .eq('chat_id', chatId);

    if (error) {
      console.error('❌ خطا در غیرفعال‌سازی گروه:', error);
      ctx.reply('❌ خطا در غیرفعال‌سازی گروه.');
      return;
    }

    ctx.reply('❌ ربات با موفقیت غیرفعال شد! از این پس کاربران جدید قرنطینه نخواهند شد.');
    
    // ارسال گزارش به مالک
    const reportMessage = `
🔴 **ربات در گروه غیرفعال شد**

🏠 گروه: ${existingChat.chat_title || ctx.chat.title}
🆔 آیدی: ${ctx.chat.id}

👤 غیرفعال‌کننده: ${ctx.from.first_name} ${ctx.from.last_name || ''} (${ctx.from.username ? `@${ctx.from.username}` : 'بدون یوزرنیم'})
🆔 آیدی کاربر: ${ctx.from.id}

⏰ زمان: ${formatPersianDate()}
    `;
    
    await sendReportToOwner(reportMessage);
    await logAction('chat_deactivated', userId, chatId, {
      chat_title: ctx.chat.title
    });
  } catch (error) {
    console.error('❌ خطا در غیرفعال‌سازی گروه:', error);
    ctx.reply('❌ خطا در غیرفعال‌سازی گروه.');
  }
});

// دستور وضعیت گروه
bot.command('status', async (ctx) => {
  if (!ctx.message.chat.type.includes('group')) {
    ctx.reply('این دستور فقط در گروه‌ها قابل استفاده است.');
    return;
  }

  const chatId = ctx.chat.id.toString();
  const userId = ctx.message.from.id;

  if (!checkRateLimit(userId, 'status')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }

  try {
    const { data: allowedChat } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (allowedChat) {
      ctx.reply('✅ ربات در این گروه فعال است و کاربران جدید را قرنطینه می‌کند.');
    } else {
      ctx.reply('❌ ربات در این گروه غیرفعال است. برای فعال‌سازی از دستور /on استفاده کنید.');
    }
  } catch (error) {
    console.error('❌ خطا در بررسی وضعیت:', error);
    ctx.reply('خطا در بررسی وضعیت ربات.');
  }
});

// دستور راهنما
bot.command('help', (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'help')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  const helpText = `
🤖 راهنمای ربات قرنطینه:

/on - فعال‌سازی ربات در گروه (فقط مالک)
/off - غیرفعال‌سازی ربات در گروه (فقط مالک)
/status - نمایش وضعیت ربات در گروه
/help - نمایش این راهنما

پس از فعال‌سازی، کاربران جدید به صورت خودکار قرنطینه می‌شوند و فقط در یک گروه می‌توانند عضو باشند.
  `;
  
  ctx.reply(helpText);
  logAction('help_requested', ctx.from.id);
});

// ==================[ پردازش اعضای جدید - بهبود یافته برای تشخیص مالک ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    console.log(`🆕 اعضای جدید به گروه ${ctx.chat.id} اضافه شدند`);
    
    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot && member.username === ctx.botInfo.username) {
        // اگر ربات خودش اضافه شده
        console.log(`🤖 ربات توسط کاربر ${ctx.from.id} اضافه شد`);
        console.log(`🔍 بررسی مالک: ${ctx.from.id} == ${OWNER_ID}`);
        
        // بررسی مستقیم مالک بودن
        if (!isOwner(ctx.from.id)) {
          console.log(`❌ کاربر ${ctx.from.id} مالک نیست - ربات لفت می‌دهد`);
          await ctx.reply('❌ فقط مالک ربات می‌تواند ربات را اضافه کند.');
          await ctx.leaveChat();
          return;
        }
        
        // اگر مالک است
        console.log(`✅ کاربر ${ctx.from.id} مالک است - ربات می‌ماند`);
        await ctx.reply(
          '🤖 ربات اضافه شد!\n\n' +
          'برای فعال‌سازی و شروع قرنطینه کاربران جدید، از دستور /on استفاده کنید.\n' +
          'برای غیرفعال‌سازی از دستور /off استفاده کنید.'
        );
      } else if (!member.is_bot) {
        // اگر کاربر عادی اضافه شده
        console.log(`👤 کاربر عادی اضافه شد: ${member.first_name} (${member.id})`);
        await handleNewUser(ctx, member);
      }
    }
  } catch (error) {
    console.error('❌ خطا در پردازش عضو جدید:', error);
  }
});

// ==================[ endpointهای API ]==================
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
    
    // بررسی وضعیت کاربر در دیتابیس
    const { data: user, error } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', userId)
      .single();
      
    if (error || !user) {
      return res.status(200).json({ 
        isQuarantined: false,
        botId: SELF_BOT_ID
      });
    }
    
    res.status(200).json({ 
      isQuarantined: user.is_quarantined,
      currentChatId: user.current_chat_id,
      username: user.username,
      firstName: user.first_name,
      botId: SELF_BOT_ID
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
        
      // حذف کاربر از گروه‌های محلی (به جز گروه مورد نظر)
      await removeUserFromLocalChats(userId, chatId);
      
    } else if (action === 'release') {
      // آزاد کردن کاربر
      await supabase
        .from('quarantine_users')
        .update({ 
          is_quarantined: false,
          current_chat_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);
    }
    
    // پاک کردن کش
    cache.del(`quarantine:${userId}`);
    
    console.log(`✅ هماهنگی کاربر ${userId} برای عمل ${action} تکمیل شد`);
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
    
    // خارج کردن کاربر از قرنطینه
    const { error } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);
      
    if (error) {
      console.error('❌ خطا در خارج کردن کاربر از قرنطینه:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    // پاک کردن کش کاربر
    cache.del(`quarantine:${userId}`);
    
    // هماهنگی با سایر ربات‌ها
    if (SYNC_ENABLED && sourceBot !== SELF_BOT_ID) {
      await syncUserWithOtherBots(userId, null, 'release');
    }
    
    console.log(`✅ کاربر ${userId} از طریق API از قرنطینه خارج شد (درخواست از: ${sourceBot || 'unknown'})`);
    res.status(200).json({ 
      success: true,
      botId: SELF_BOT_ID,
      message: `User ${userId} released from quarantine`
    });
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
    version: '10.0.0'
  });
});

// ==================[ راه‌اندازی سرور ]==================
app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => res.send('ربات قرنطینه فعال است!'));
app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

app.listen(PORT, () => {
  console.log(`✅ سرور روی پورت ${PORT} راه‌اندازی شد`);
  console.log(`🤖 شناسه ربات: ${SELF_BOT_ID}`);
  console.log(`🔗 حالت هماهنگی: ${SYNC_ENABLED ? 'فعال' : 'غیرفعال'}`);
  console.log(`👥 تعداد ربات‌های متصل: ${BOT_INSTANCES.length}`);
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
    .catch(error => console.error('❌ خطا در تنظیم Webhook:', error));
} else {
  console.warn('⚠️ آدرس Render تعریف نشده است، از حالت polling استفاده می‌شود');
  bot.launch();
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = app;
