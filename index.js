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

// ==================[ سیستم کشینگ قوی جدید ]==================
const cache = new NodeCache({ 
  stdTTL: 600,           // زمان پیش‌فرض انقضا: 10 دقیقه
  checkperiod: 120,      // بررسی هر 2 دقیقه
  maxKeys: 1000          // حداکثر 1000 کلید در حافظه
});
// ==================[ پایان سیستم کشینگ ]==================

// ==================[ تنظیمات چندرباتی ]==================
const BOT_INSTANCES = process.env.BOT_INSTANCES ? 
  JSON.parse(process.env.BOT_INSTANCES) : [];
  
const SELF_BOT_ID = process.env.SELF_BOT_ID || 'quarantine_1';
const SYNC_ENABLED = process.env.SYNC_ENABLED === 'true';
const OWNER_ID = process.env.OWNER_ID || '123456789'; // آیدی عددی مالک
// ==================[ پایان تنظیمات چندرباتی ]==================

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
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Telegraf(process.env.BOT_TOKEN);

// محدودیت نرخ درخواست
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

// ==================[ تابع جدید: بررسی مالک بودن کاربر ]==================
const isOwner = (userId) => {
  const ownerIds = OWNER_ID.split(',').map(id => id.trim());
  return ownerIds.includes(userId.toString());
};
// ==================[ پایان تابع بررسی مالک ]==================

// توابع کمکی
const logAction = async (action, userId, chatId = null, details = {}) => {
  try {
    await supabase.from('action_logs').insert({
      action, user_id: userId, chat_id: chatId, details, created_at: new Date().toISOString()
    });
  } catch (error) {
    logger.error('خطا در ثبت فعالیت:', error);
  }
};

// ==================[ تابع جدید: ارسال گزارش به مالک ]==================
const reportToOwner = async (message, extra = {}) => {
  try {
    await bot.telegram.sendMessage(OWNER_ID, message, { ...extra });
    logger.info('گزارش به مالک ارسال شد');
  } catch (error) {
    logger.error('خطا در ارسال گزارش به مالک:', error);
  }
};

// ==================[ تابع جدید: گزارش تخلف کاربر ]==================
const reportViolation = async (userId, username, firstName, originalChatId, newChatId, newChatTitle) => {
  const violationMessage = `🚨 **گزارش تخلف قرنطینه**\n\n👤 کاربر: ${firstName} ${username ? `(@${username})` : ''}\n🆔 آیدی: ${userId}\n\n📋 نوع تخلف: کاربر قرنطینه شده از گروه خارج نشده و به گروه جدید پیوسته است\n\n📍 گروه مبدا: ${originalChatId}\n📍 گروه مقصد: ${newChatTitle} (${newChatId})\n\n⏰ زمان: ${new Date().toLocaleString('fa-IR')}\n🤖 ربات گزارش‌دهنده: ${SELF_BOT_ID}`;
  
  await reportToOwner(violationMessage);
  await logAction('quarantine_violation_reported', userId, newChatId, {
    original_chat: originalChatId,
    new_chat: newChatId,
    new_chat_title: newChatTitle,
    username,
    first_name: firstName
  });
};
// ==================[ پایان توابع گزارش‌دهی ]==================

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
    logger.error('خطا در بررسی ادمین:', error);
    return false;
  }
};

const isBotAdmin = async (chatId) => {
  try {
    const cacheKey = `botadmin:${chatId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    const numericChatId = parseInt(chatId);
    const self = await bot.telegram.getChatMember(numericChatId, bot.botInfo.id);
    const isAdmin = ['administrator', 'creator'].includes(self.status);
    
    cache.set(cacheKey, isAdmin, 300);
    return isAdmin;
  } catch (error) {
    logger.error('خطا در بررسی ادمین بودن ربات:', error);
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
    logger.error('خطا در بررسی وضعیت کاربر:', error);
    return null;
  }
};

const removeUserFromChat = async (chatId, userId) => {
  try {
    if (!(await isBotAdmin(chatId))) {
      logger.error('ربات در گروه ادمین نیست');
      return false;
    }
    
    const userStatus = await getUserStatus(chatId, userId);
    if (['not_member', 'left', 'kicked'].includes(userStatus)) return true;
    if (userStatus === 'creator') return false;
    
    await bot.telegram.banChatMember(chatId, userId, {
      until_date: Math.floor(Date.now() / 1000) + 30
    });
    
    await bot.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
    logger.info(`کاربر ${userId} از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    if (error.response?.description?.includes("can't remove chat owner")) return false;
    if (error.response?.error_code === 400 && error.response.description?.includes("user not found")) return true;
    
    logger.error('خطا در حذف کاربر از گروه:', error);
    return false;
  }
};

// ==================[ توابع جدید برای هماهنگی بین ربات‌ها ]==================
const checkUserInOtherBots = async (userId) => {
  try {
    if (!SYNC_ENABLED || BOT_INSTANCES.length === 0) {
      return { isQuarantined: false, bots: [] };
    }

    console.log(`🔍 بررسی کاربر ${userId} در سایر ربات‌ها...`);
    
    const promises = BOT_INSTANCES
      .filter(bot => bot.id !== SELF_BOT_ID && bot.type === 'quarantine')
      .map(async (botInstance) => {
        try {
          let apiUrl = botInstance.url;
          if (!apiUrl.startsWith('http')) {
            apiUrl = `https://${apiUrl}`;
          }
          
          apiUrl = apiUrl.replace(/\/$/, '');
          const fullUrl = `${apiUrl}/api/check-user/${userId}`;
          
          const response = await axios.get(fullUrl, {
            timeout: 8000,
            headers: {
              'Authorization': `Bearer ${botInstance.secretKey}`
            }
          });

          if (response.data.is_quarantined) {
            return {
              botId: botInstance.id,
              isQuarantined: true,
              currentChatId: response.data.current_chat_id,
              chatTitle: response.data.chat_title,
              username: response.data.username,
              first_name: response.data.first_name
            };
          }
          
          return {
            botId: botInstance.id,
            isQuarantined: false
          };
        } catch (error) {
          console.error(`❌ خطا در ارتباط با ${botInstance.id}:`, error.message);
          return {
            botId: botInstance.id,
            isQuarantined: false,
            error: error.message
          };
        }
      });
    
    const results = await Promise.all(promises);
    const quarantinedBots = results.filter(r => r.isQuarantined);
    
    console.log(`📊 نتایج بررسی: ${quarantinedBots.length} ربات کاربر را قرنطینه کرده‌اند`);
    
    return {
      isQuarantined: quarantinedBots.length > 0,
      bots: quarantinedBots
    };
  } catch (error) {
    console.error('❌ خطا در بررسی کاربر در ربات‌های دیگر:', error);
    return { isQuarantined: false, bots: [] };
  }
};

const removeUserFromOtherBots = async (userId, currentChatId) => {
  try {
    if (!SYNC_ENABLED || BOT_INSTANCES.length === 0) {
      return { removedCount: 0, totalBots: 0 };
    }

    console.log(`🗑️ درخواست حذف کاربر ${userId} از سایر ربات‌ها...`);
    
    const promises = BOT_INSTANCES
      .filter(bot => bot.id !== SELF_BOT_ID && bot.type === 'quarantine')
      .map(async (botInstance) => {
        try {
          let apiUrl = botInstance.url;
          if (!apiUrl.startsWith('http')) {
            apiUrl = `https://${apiUrl}`;
          }
          
          apiUrl = apiUrl.replace(/\/$/, '');
          const fullUrl = `${apiUrl}/api/remove-user`;
          
          const response = await axios.post(fullUrl, {
            userId: userId,
            secretKey: botInstance.secretKey,
            sourceBot: SELF_BOT_ID,
            currentChatId: currentChatId
          }, {
            timeout: 8000,
            headers: {
              'Content-Type': 'application/json'
            }
          });

          console.log(`✅ حذف از ${botInstance.id} موفق`);
          return { success: true, botId: botInstance.id };
        } catch (error) {
          console.error(`❌ حذف از ${botInstance.id} ناموفق:`, error.message);
          return { success: false, botId: botInstance.id, error: error.message };
        }
      });
    
    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.success).length;
    
    console.log(`✅ کاربر ${userId} از ${successCount}/${results.length} ربات حذف شد`);
    
    return {
      removedCount: successCount,
      totalBots: results.length
    };
  } catch (error) {
    console.error('❌ خطا در حذف کاربر از ربات‌های دیگر:', error);
    return { removedCount: 0, totalBots: 0 };
  }
};
// ==================[ پایان توابع هماهنگی ]==================

// ==================[ تابع اصلی کاملاً بازنویسی شده ]==================
const handleNewUser = async (ctx, user) => {
  try {
    const currentChatId = ctx.chat.id.toString();
    const currentChatTitle = ctx.chat.title || 'گروه ناشناخته';

    // بررسی اینکه گروه فعلی فعال است یا نه
    const { data: allowedChat } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', currentChatId)
      .single();

    if (!allowedChat) {
      return; // گروه فعال نیست
    }

    const now = new Date().toISOString();
    
    // بررسی کش برای کاربر
    const cacheKey = `user:${user.id}`;
    let cachedUser = cache.get(cacheKey);
    
    if (!cachedUser) {
      // بررسی کاربر در دیتابیس محلی
      const { data: localUser } = await supabase
        .from('quarantine_users')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_quarantined', true)
        .single();
      
      cachedUser = localUser;
      if (localUser) {
        cache.set(cacheKey, localUser, 600); // کش برای 10 دقیقه
      }
    }

    // بررسی کاربر در سایر ربات‌های قرنطینه
    const remoteCheck = await checkUserInOtherBots(user.id);
    
    if (remoteCheck.isQuarantined && remoteCheck.bots.length > 0) {
      // کاربر در ربات دیگری قرنطینه است
      const remoteBot = remoteCheck.bots[0];
      
      // حذف کاربر از گروه فعلی
      await removeUserFromChat(currentChatId, user.id);
      
      // ارسال گزارش تخلف به مالک
      await reportViolation(
        user.id, 
        user.username, 
        user.first_name, 
        remoteBot.currentChatId, 
        currentChatId, 
        currentChatTitle
      );
      
      logger.info(`کاربر ${user.id} از گروه ${currentChatId} حذف و تخلفش گزارش شد`);
      
      // حذف کاربر از سایر گروه‌های این ربات
      await removeUserFromAllOtherChats(remoteBot.currentChatId, user.id);
      
      return;
    }
    
    if (cachedUser) {
      // کاربر در همین ربات اما در گروه دیگری قرنطینه است
      if (cachedUser.current_chat_id && cachedUser.current_chat_id !== currentChatId) {
        await removeUserFromChat(currentChatId, user.id);
        await removeUserFromAllOtherChats(cachedUser.current_chat_id, user.id);
        
        // گزارش تخلف
        await reportViolation(
          user.id, 
          user.username, 
          user.first_name, 
          cachedUser.current_chat_id, 
          currentChatId, 
          currentChatTitle
        );
        return;
      }
      
      // آپدیت اطلاعات کاربر
      await supabase
        .from('quarantine_users')
        .update({ 
          username: user.username, 
          first_name: user.first_name, 
          updated_at: now 
        })
        .eq('user_id', user.id);
        
    } else {
      // کاربر جدید است - قرنطینه کردن
      await supabase.from('quarantine_users').upsert({
        user_id: user.id,
        username: user.username,
        first_name: user.first_name,
        is_quarantined: true,
        current_chat_id: currentChatId,
        created_at: now,
        updated_at: now
      }, { onConflict: 'user_id' });
      
      // کاربر را از تمام گروه‌های دیگر این ربات حذف کن
      await removeUserFromAllOtherChats(currentChatId, user.id);
      
      // کاربر را از سایر ربات‌ها حذف کن
      await removeUserFromOtherBots(user.id, currentChatId);
      
      await logAction('user_quarantined', user.id, currentChatId, {
        username: user.username, 
        first_name: user.first_name,
        removed_from_other_bots: true
      });
      
      // گزارش قرنطینه جدید به مالک
      const quarantineMessage = `🟢 **کاربر جدید قرنطینه شد**\n\n👤 کاربر: ${user.first_name} ${user.username ? `(@${user.username})` : ''}\n🆔 آیدی: ${user.id}\n\n🏠 گروه: ${currentChatTitle} (${currentChatId})\n\n⏰ زمان: ${new Date().toLocaleString('fa-IR')}\n🤖 ربات: ${SELF_BOT_ID}`;
      await reportToOwner(quarantineMessage);
    }
    
    // بروزرسانی کش
    cache.set(cacheKey, {
      user_id: user.id,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId
    }, 600);
    
  } catch (error) {
    logger.error('خطا در پردازش کاربر جدید:', error);
  }
};

// ==================[ تابع بهبود یافته برای حذف کاربر از گروه‌های دیگر ]==================
const removeUserFromAllOtherChats = async (currentChatId, userId) => {
  try {
    const { data: allChats, error } = await supabase.from('allowed_chats').select('chat_id, chat_title');
    if (error) {
      logger.error('خطا در دریافت گروه‌ها:', error);
      return;
    }
    
    if (allChats?.length > 0) {
      let removedCount = 0;
      
      for (const chat of allChats) {
        if (chat.chat_id.toString() !== currentChatId.toString()) {
          const removalSuccess = await removeUserFromChat(chat.chat_id, userId);
          if (removalSuccess) {
            removedCount++;
            logger.info(`کاربر ${userId} از گروه ${chat.chat_id} (${chat.chat_title}) حذف شد`);
            
            await logAction('user_removed_from_other_chat', userId, chat.chat_id, {
              original_chat: currentChatId,
              target_chat: chat.chat_id
            });
          }
        }
      }
      
      logger.info(`تعداد ${removedCount} گروه برای کاربر ${userId} پردازش شد`);
    }
  } catch (error) {
    logger.error('خطا در حذف کاربر از گروه‌های دیگر:', error);
  }
};

const checkQuarantineExpiry = async () => {
  try {
    const { data: expiredUsers } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('is_quarantined', true)
      .lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    
    if (expiredUsers?.length > 0) {
      for (const user of expiredUsers) {
        await supabase
          .from('quarantine_users')
          .update({ 
            is_quarantined: false, 
            current_chat_id: null, 
            updated_at: new Date().toISOString() 
          })
          .eq('user_id', user.user_id);
          
        // پاک کردن کش کاربر
        cache.del(`user:${user.user_id}`);
          
        await logAction('quarantine_expired', user.user_id, null, {
          username: user.username, 
          first_name: user.first_name
        });
      }
    }
  } catch (error) {
    logger.error('خطا در بررسی انقضای قرنطینه:', error);
  }
};

// ==================[ endpointهای جدید و بهینه شده ]==================
app.post('/api/release-user', async (req, res) => {
  try {
    const { userId, secretKey, sourceBot } = req.body;
    
    if (!secretKey || secretKey !== process.env.API_SECRET_KEY) {
      logger.warn('درخواست غیرمجاز برای آزادسازی کاربر');
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
      logger.error('خطا در خارج کردن کاربر از قرنطینه:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    // پاک کردن کش کاربر
    cache.del(`user:${userId}`);
    
    logger.info(`کاربر ${userId} از طریق API از قرنطینه خارج شد (درخواست از: ${sourceBot || 'unknown'})`);
    res.status(200).json({ 
      success: true,
      botId: SELF_BOT_ID,
      message: `User ${userId} released from quarantine`
    });
  } catch (error) {
    logger.error('خطا در endpoint آزاد کردن کاربر:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================[ endpoint جدید: بررسی کاربر ]==================
app.get('/api/check-user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const authHeader = req.headers.authorization;
    const secretKey = authHeader?.replace('Bearer ', '');
    
    if (!secretKey || secretKey !== process.env.API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // بررسی کش اول
    const cacheKey = `user:${userId}`;
    const cachedUser = cache.get(cacheKey);
    
    if (cachedUser) {
      return res.status(200).json({
        success: true,
        user_id: parseInt(userId),
        is_quarantined: cachedUser.is_quarantined,
        current_chat_id: cachedUser.current_chat_id,
        username: cachedUser.username,
        first_name: cachedUser.first_name,
        checked_by: SELF_BOT_ID,
        source: 'cache'
      });
    }
    
    // بررسی دیتابیس
    const { data: user, error } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', parseInt(userId))
      .eq('is_quarantined', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('خطا در بررسی کاربر:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    if (user) {
      // ذخیره در کش
      cache.set(cacheKey, user, 600);
    }
    
    // پیدا کردن عنوان گروه
    let chatTitle = 'نامشخص';
    if (user?.current_chat_id) {
      try {
        const chat = await bot.telegram.getChat(user.current_chat_id);
        chatTitle = chat.title || 'گروه ناشناخته';
      } catch (e) {
        console.error('خطا در دریافت اطلاعات گروه:', e);
      }
    }
    
    res.status(200).json({
      success: true,
      user_id: parseInt(userId),
      is_quarantined: !!user,
      current_chat_id: user?.current_chat_id || null,
      chat_title: chatTitle,
      username: user?.username || null,
      first_name: user?.first_name || null,
      checked_by: SELF_BOT_ID,
      source: user ? 'database' : 'not_found'
    });
  } catch (error) {
    logger.error('خطا در endpoint بررسی کاربر:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================[ endpoint جدید: حذف کاربر ]==================
app.post('/api/remove-user', async (req, res) => {
  try {
    const { userId, secretKey, sourceBot, currentChatId } = req.body;
    
    if (!secretKey || secretKey !== process.env.API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    console.log(`🗑️ درخواست حذف کاربر ${userId} از ربات ${SELF_BOT_ID} (درخواست از: ${sourceBot})`);
    
    // حذف کاربر از تمام گروه‌های این ربات به جز گروه جاری
    const { data: allChats } = await supabase.from('allowed_chats').select('chat_id, chat_title');
    
    let removedCount = 0;
    if (allChats?.length > 0) {
      for (const chat of allChats) {
        if (!currentChatId || chat.chat_id.toString() !== currentChatId.toString()) {
          const removalSuccess = await removeUserFromChat(chat.chat_id, userId);
          if (removalSuccess) {
            removedCount++;
          }
        }
      }
    }
    
    // پاک کردن کش کاربر
    cache.del(`user:${userId}`);
    
    logger.info(`کاربر ${userId} از ${removedCount} گروه در ربات ${SELF_BOT_ID} حذف شد`);
    
    res.status(200).json({
      success: true,
      botId: SELF_BOT_ID,
      removed_count: removedCount,
      message: `کاربر از ${removedCount} گروه حذف شد`
    });
  } catch (error) {
    logger.error('خطا در endpoint حذف کاربر:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/bot-status', (req, res) => {
  const cacheStats = cache.getStats();
  const memoryUsage = process.memoryUsage();
  
  res.status(200).json({
    status: 'online',
    botId: SELF_BOT_ID,
    type: 'quarantine',
    timestamp: new Date().toISOString(),
    connectedBots: BOT_INSTANCES.length,
    version: '4.0.0',
    features: ['caching', 'owner-reports', 'multi-bot-sync', 'auto-remove'],
    cache: {
      keys: cacheStats.keys,
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate: Math.round((cacheStats.hits / (cacheStats.hits + cacheStats.misses || 1)) * 100) + '%'
    },
    memory: {
      used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB'
    }
  });
});

// ==================[ endpoint جدید: هماهنگی آزادسازی ]==================
app.post('/api/sync-release', async (req, res) => {
  try {
    const { userId, secretKey, sourceBot } = req.body;
    
    if (!secretKey || secretKey !== process.env.API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log(`🔄 درخواست هماهنگی از ${sourceBot} برای کاربر ${userId}`);
    
    const { error } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);
    
    if (error) {
      logger.error('خطا در آزادسازی هماهنگ:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    cache.del(`user:${userId}`);
    
    logger.info(`کاربر ${userId} از طریق هماهنگی با ${sourceBot} آزاد شد`);
    res.status(200).json({
      success: true,
      botId: SELF_BOT_ID,
      processed: true
    });
  } catch (error) {
    logger.error('❌ خطا در پردازش هماهنگی:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// ==================[ پایان endpointهای جدید ]==================

// ==================[ دستورات ربات - کاملاً بازنویسی شده ]==================
bot.start((ctx) => {
  if (!checkRateLimit(ctx.from.id, 'start')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  ctx.reply('ناظر اکلیس در خدمت شماست 🥷🏻');
  logAction('bot_started', ctx.from.id);
});

// ==================[ دستور /on - کاملاً پیاده‌سازی شده ]==================
bot.command('on', async (ctx) => {
  if (!ctx.message.chat.type.includes('group')) {
    ctx.reply('این دستور فقط در گروه‌ها قابل استفاده است.');
    return;
  }

  const chatId = ctx.chat.id.toString();
  const userId = ctx.message.from.id;

  // بررسی مالک بودن کاربر
  if (!isOwner(userId.toString())) {
    ctx.reply('❌ فقط مالک‌های ربات می‌توانند از این دستور استفاده کنند.');
    return;
  }

  if (!checkRateLimit(userId, 'on')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }

  try {
    // بررسی اینکه آیا ربات ادمین است
    if (!(await isBotAdmin(chatId))) {
      ctx.reply('❌ ربات باید در این گروه ادمین باشد تا بتواند فعال شود.');
      return;
    }

    // بررسی اینکه گروه قبلاً ثبت شده یا نه
    const { data: existingChat, error: checkError } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      logger.error('خطا در بررسی گروه:', checkError);
      ctx.reply('خطا در بررسی وضعیت گروه.');
      return;
    }

    if (existingChat) {
      ctx.reply('✅ ربات قبلاً در این گروه فعال شده است.');
      return;
    }

    // ثبت گروه در دیتابیس
    const { error: insertError } = await supabase
      .from('allowed_chats')
      .insert({
        chat_id: chatId,
        chat_title: ctx.chat.title || 'گروه بدون نام',
        enabled: true,
        created_at: new Date().toISOString()
      });

    if (insertError) {
      logger.error('خطا در فعال‌سازی ربات:', insertError);
      ctx.reply('خطا در فعال‌سازی ربات.');
      return;
    }

    // پاک کردن کش مربوط به گروه
    cache.del(`allowed_chat:${chatId}`);

    ctx.reply('✅ ربات با موفقیت در این گروه فعال شد!\n\nاز این پس کاربران جدید به صورت خودکار قرنطینه می‌شوند.');
    await logAction('bot_activated', userId, chatId, {
      chat_title: ctx.chat.title
    });

    // گزارش به مالک
    const activationMessage = `🟢 **ربات در گروه جدید فعال شد**\n\n🏠 گروه: ${ctx.chat.title || 'بدون نام'}\n🆔 آیدی: ${chatId}\n\n👤 فعال‌کننده: ${ctx.message.from.first_name} ${ctx.message.from.username ? `(@${ctx.message.from.username})` : ''}\n🆔 آیدی کاربر: ${userId}\n\n⏰ زمان: ${new Date().toLocaleString('fa-IR')}`;
    await reportToOwner(activationMessage);

  } catch (error) {
    logger.error('خطا در اجرای دستور /on:', error);
    ctx.reply('خطا در فعال‌سازی ربات.');
  }
});

// ==================[ دستور /off - کاملاً پیاده‌سازی شده ]==================
bot.command('off', async (ctx) => {
  if (!ctx.message.chat.type.includes('group')) {
    ctx.reply('این دستور فقط در گروه‌ها قابل استفاده است.');
    return;
  }

  const chatId = ctx.chat.id.toString();
  const userId = ctx.message.from.id;

  // بررسی مالک بودن کاربر
  if (!isOwner(userId.toString())) {
    ctx.reply('❌ فقط مالک‌های ربات می‌توانند از این دستور استفاده کنند.');
    return;
  }

  if (!checkRateLimit(userId, 'off')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }

  try {
    // بررسی اینکه گروه فعال است یا نه
    const { data: existingChat, error: checkError } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      logger.error('خطا در بررسی گروه:', checkError);
      ctx.reply('خطا در بررسی وضعیت گروه.');
      return;
    }

    if (!existingChat) {
      ctx.reply('❌ ربات در این گروه فعال نیست.');
      return;
    }

    // غیرفعال کردن گروه
    const { error: deleteError } = await supabase
      .from('allowed_chats')
      .delete()
      .eq('chat_id', chatId);

    if (deleteError) {
      logger.error('خطا در غیرفعال‌سازی ربات:', deleteError);
      ctx.reply('خطا در غیرفعال‌سازی ربات.');
      return;
    }

    // پاک کردن کش مربوط به گروه
    cache.del(`allowed_chat:${chatId}`);

    ctx.reply('✅ ربات با موفقیت در این گروه غیرفعال شد.\n\nکاربران جدید دیگر قرنطینه نخواهند شد.');
    await logAction('bot_deactivated', userId, chatId, {
      chat_title: ctx.chat.title
    });

    // گزارش به مالک
    const deactivationMessage = `🔴 **ربات در گروه غیرفعال شد**\n\n🏠 گروه: ${ctx.chat.title || 'بدون نام'}\n🆔 آیدی: ${chatId}\n\n👤 غیرفعال‌کننده: ${ctx.message.from.first_name} ${ctx.message.from.username ? `(@${ctx.message.from.username})` : ''}\n🆔 آیدی کاربر: ${userId}\n\n⏰ زمان: ${new Date().toLocaleString('fa-IR')}`;
    await reportToOwner(deactivationMessage);

  } catch (error) {
    logger.error('خطا در اجرای دستور /off:', error);
    ctx.reply('خطا در غیرفعال‌سازی ربات.');
  }
});

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

    const cacheStats = cache.getStats();
    const { data: quarantineStats } = await supabase
      .from('quarantine_users')
      .select('user_id', { count: 'exact' })
      .eq('is_quarantined', true);

    if (allowedChat) {
      ctx.reply(`✅ ربات در این گروه فعال است\n\n📊 آمار سیستم:\n👥 کاربران قرنطینه: ${quarantineStats?.length || 0} نفر\n🤖 ربات‌های متصل: ${BOT_INSTANCES.length} عدد\n💾 کش: ${cacheStats.keys} کلید\n🎯 ضریب hit: ${Math.round((cacheStats.hits / (cacheStats.hits + cacheStats.misses || 1)) * 100)}%`);
    } else {
      ctx.reply('❌ ربات در این گروه غیرفعال است. برای فعال‌سازی از دستور /on استفاده کنید.');
    }
  } catch (error) {
    logger.error('خطا در بررسی وضعیت:', error);
    ctx.reply('خطا در بررسی وضعیت ربات.');
  }
});

bot.command('راهنما', (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'help')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  const helpText = `
🤖 راهنمای ربات قرنطینه - نسخه پیشرفته:

/on - فعال‌سازی ربات در گروه (فقط مالک‌ها)
/off - غیرفعال‌سازی ربات در گروه (فقط مالک‌ها)
/status - نمایش وضعیت ربات و آمار سیستم
/راهنما - نمایش این راهنما

✨ ویژگی‌های جدید:
🔗 هماهنگی چندرباتی
💾 سیستم کشینگ پیشرفته
🚨 گزارش تخلف به مالک
🔄 شناسایی و حذف خودکار
  `;
  
  ctx.reply(helpText);
  logAction('help_requested', ctx.from.id);
});

// پردازش اعضای جدید
bot.on('new_chat_members', async (ctx) => {
  try {
    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot && member.username === ctx.botInfo.username) {
        if (!(await isChatAdmin(ctx.chat.id, ctx.message.from.id))) {
          await ctx.reply('فقط ادمین‌ها می‌توانند ربات را اضافه کنند.');
          await ctx.leaveChat();
          return;
        }
        
        await ctx.reply(
          '🤖 ربات اضافه شد!\n' +
          'برای فعال‌سازی و شروع قرنطینه کاربران جدید، از دستور /on استفاده کنید.\n' +
          'برای غیرفعال‌سازی از دستور /off استفاده کنید.'
        );
      } else if (!member.is_bot) {
        await handleNewUser(ctx, member);
      }
    }
  } catch (error) {
    logger.error('خطا در پردازش عضو جدید:', error);
  }
});

// وب سرور
app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => res.send('🤖 ربات قرنطینه فعال است! (نسخه پیشرفته)'));
app.get('/health', (req, res) => res.status(200).json({ 
  status: 'OK', 
  version: '4.0.0',
  features: ['caching', 'reports', 'multi-bot']
}));

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  console.log(`🚀 ربات قرنطینه در پورت ${PORT} راه‌اندازی شد`);
  console.log(`🤖 شناسه ربات: ${SELF_BOT_ID}`);
  console.log(`🔗 حالت هماهنگی: ${SYNC_ENABLED ? 'فعال' : 'غیرفعال'}`);
  console.log(`👥 تعداد ربات‌های متصل: ${BOT_INSTANCES.length}`);
  console.log(`💾 سیستم کشینگ: فعال (حداکثر ${cache.getStats().max} کلید)`);
  console.log(`👑 گزارش به مالک: فعال (آیدی: ${OWNER_ID})`);
});

// بررسی انقضای قرنطینه هر 6 ساعت
cron.schedule('0 */6 * * *', () => checkQuarantineExpiry());

// فعال سازی وب هوک
if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => logger.info(`Webhook set to: ${webhookUrl}`))
    .catch(error => logger.error('Error setting webhook:', error));
} else {
  logger.warn('آدرس Render تعریف نشده است، از حالت polling استفاده می‌شود');
  bot.launch();
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = app;
