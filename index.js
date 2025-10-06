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

// ==================[ تنظیمات کشینگ قوی ]==================
const cache = new NodeCache({ 
  stdTTL: 300,    // زمان زندگی پیش‌فرش داده‌ها در کش: ۵ دقیقه
  checkperiod: 600, // بازه بررسی داده‌های منقضی: ۱۰ دقیقه
  maxKeys: 10000   // حداکثر تعداد کلید در کش برای جلوگیری از پر شدن حافظه
});
// ==================[ پایان تنظیمات کشینگ ]==================

// ==================[ تنظیمات چندرباتی ]==================
const BOT_INSTANCES = process.env.BOT_INSTANCES ? 
  JSON.parse(process.env.BOT_INSTANCES) : [];
  
const SELF_BOT_ID = process.env.SELF_BOT_ID || 'quarantine_1';
const SYNC_ENABLED = process.env.SYNC_ENABLED === 'true';
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

// Supabase - هر ربات از دیتابیس خودش استفاده می‌کند
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Telegraf(process.env.BOT_TOKEN);

// ==================[ تابع جدید: ارسال پیام اطلاع‌رسانی به مالک ]==================
const sendViolationAlertToOwner = async (violatorUserId, violatorUsername, violatorFirstName, targetChatId, targetChatTitle) => {
  try {
    const ownerId = process.env.OWNER_ID;
    
    if (!ownerId) {
      console.log('⚠️  شناسه مالک (OWNER_ID) تنظیم نشده است. امکان ارسال اطلاع‌رسانی وجود ندارد.');
      return;
    }

    const violationMessage = `🚨 **اطلاع‌رسانی تخلف قرنطینه**\n\n` +
                           `• کاربر: ${violatorFirstName} (${violatorUsername || 'بدون یوزرنیم'})\n` +
                           `• آیدی عددی: ${violatorUserId}\n` +
                           `• گروه مقصد: ${targetChatTitle}\n` +
                           `• آیدی گروه: ${targetChatId}\n` +
                           `• زمان: ${new Date().toLocaleString('fa-IR')}\n\n` +
                           `این کاربر هنوز در وضعیت قرنطینه قرار دارد و مجاز به عضویت در گروه‌های دیگر نیست.`;

    await bot.telegram.sendMessage(ownerId, violationMessage, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });

    console.log(`✅ اطلاع‌رسانی تخلف برای کاربر ${violatorUserId} به مالک ارسال شد.`);
    
    // ثبت لاگ اقدام
    await logAction('violation_alert_sent', violatorUserId, targetChatId, {
      violator_username: violatorUsername,
      violator_first_name: violatorFirstName,
      target_chat_id: targetChatId,
      target_chat_title: targetChatTitle,
      alerted_owner: ownerId
    });
  } catch (error) {
    console.error('❌ خطا در ارسال پیام اطلاع‌رسانی به مالک:', error);
    logger.error('خطا در ارسال اطلاع‌رسانی تخلف:', error);
  }
};
// ==================[ پایان تابع جدید ]==================

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

// تابع اصلاح شده برای بررسی ادمین بودن ربات
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

// ==================[ تابع جدید: بررسی وضعیت کاربر در سایر ربات‌ها ]==================
const checkUserInOtherBots = async (userId) => {
  try {
    if (!SYNC_ENABLED || BOT_INSTANCES.length === 0) {
      return null;
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
          
          console.log(`🔗 درخواست به: ${fullUrl}`);

          const response = await axios.get(fullUrl, {
            timeout: 8000,
            headers: {
              'Authorization': `Bearer ${botInstance.secretKey}`
            }
          });

          console.log(`✅ پاسخ از ${botInstance.id}:`, response.data);
          
          if (response.data.is_quarantined) {
            return {
              botId: botInstance.id,
              isQuarantined: true,
              currentChatId: response.data.current_chat_id,
              username: response.data.username
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
    
    console.log(`📊 نتایج بررسی: ${quarantinedBots.length}/${results.length} ربات کاربر را قرنطینه کرده‌اند`);
    
    if (quarantinedBots.length > 0) {
      return quarantinedBots[0]; // اولین رباتی که کاربر را قرنطینه کرده
    }
    
    return null;
  } catch (error) {
    console.error('❌ خطا در بررسی کاربر در ربات‌های دیگر:', error);
    return null;
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
          }
        }
      }
      
      logger.info(`تعداد ${removedCount} گروه برای کاربر ${userId} پردازش شد`);
    }
  } catch (error) {
    logger.error('خطا در حذف کاربر از گروه‌های دیگر:', error);
  }
};

// ==================[ تابع اصلی کاملاً بازنویسی شده برای پردازش کاربر جدید ]==================
const handleNewUser = async (ctx, user) => {
  try {
    // بررسی اینکه گروه فعلی فعال است یا نه
    const { data: allowedChat } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', ctx.chat.id.toString())
      .single();

    if (!allowedChat) {
      return; // گروه فعال نیست، کاری نکن
    }

    const now = new Date().toISOString();
    const currentChatId = ctx.chat.id.toString();
    const currentChatTitle = ctx.chat.title || 'گروه ناشناخته';
    
    // بررسی اولیه در دیتابیس محلی
    const { data: localUser } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_quarantined', true)
      .single();

    // بررسی کاربر در سایر ربات‌های قرنطینه
    const remoteQuarantineCheck = await checkUserInOtherBots(user.id);
    
    if (remoteQuarantineCheck && remoteQuarantineCheck.isQuarantined) {
      // کاربر در ربات دیگری قرنطینه است - حذف از گروه فعلی
      await removeUserFromChat(currentChatId, user.id);
      
      logger.info(`کاربر ${user.id} از گروه ${currentChatId} حذف شد زیرا در ربات ${remoteQuarantineCheck.botId} قرنطینه است`);
      
      // ==================[ ارسال اطلاع‌رسانی به مالک ]==================
      await sendViolationAlertToOwner(
        user.id, 
        user.username, 
        user.first_name, 
        currentChatId, 
        currentChatTitle
      );
      // ==================[ پایان اطلاع‌رسانی ]==================
      
      // ثبت لاگ برای اقدام
      await logAction('user_removed_due_to_remote_quarantine', user.id, currentChatId, {
        remote_bot: remoteQuarantineCheck.botId,
        remote_chat: remoteQuarantineCheck.currentChatId,
        username: user.username
      });
      
      return;
    }
    
    if (localUser) {
      // کاربر در همین ربات اما در گروه دیگری قرنطینه است
      if (localUser.current_chat_id && localUser.current_chat_id !== currentChatId) {
        await removeUserFromChat(currentChatId, user.id);
        await removeUserFromAllOtherChats(localUser.current_chat_id, user.id);
        
        // ==================[ ارسال اطلاع‌رسانی به مالک برای تخلف داخلی ]==================
        await sendViolationAlertToOwner(
          user.id, 
          user.username, 
          user.first_name, 
          currentChatId, 
          currentChatTitle
        );
        // ==================[ پایان اطلاع‌رسانی ]==================
        
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
      
      await logAction('user_quarantined', user.id, currentChatId, {
        username: user.username, 
        first_name: user.first_name
      });
    }
  } catch (error) {
    logger.error('خطا در پردازش کاربر جدید:', error);
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
          .update({ is_quarantined: false, current_chat_id: null, updated_at: new Date().toISOString() })
          .eq('user_id', user.user_id);
          
        await logAction('quarantine_expired', user.user_id, null, {
          username: user.username, first_name: user.first_name
        });
      }
    }
  } catch (error) {
    logger.error('خطا در بررسی انقضای قرنطینه:', error);
  }
};

// ==================[ توابع هماهنگی چندرباتی ]==================
const syncWithOtherBots = async (userId, sourceBot) => {
  try {
    console.log(`🔄 هماهنگی کاربر ${userId} با سایر ربات‌ها...`);
    
    const promises = BOT_INSTANCES
      .filter(bot => bot.id !== SELF_BOT_ID && bot.id !== sourceBot && bot.type === 'quarantine')
      .map(async (botInstance) => {
        try {
          let apiUrl = botInstance.url;
          if (!apiUrl.startsWith('http')) {
            apiUrl = `https://${apiUrl}`;
          }
          
          apiUrl = apiUrl.replace(/\/$/, '');
          const fullUrl = `${apiUrl}/api/sync-release`;
          
          const response = await axios.post(fullUrl, {
            userId: userId,
            secretKey: botInstance.secretKey,
            sourceBot: SELF_BOT_ID
          }, {
            timeout: 5000
          });
          
          console.log(`✅ هماهنگی با ${botInstance.id} موفق`);
          return { success: true, botId: botInstance.id };
        } catch (error) {
          console.error(`❌ هماهنگی با ${botInstance.id} ناموفق:`, error.message);
          return { success: false, botId: botInstance.id, error: error.message };
        }
      });
    
    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.success).length;
    
    console.log(`✅ هماهنگی کاربر ${userId} با ${successCount}/${results.length} ربات انجام شد`);
  } catch (error) {
    console.error('❌ خطا در هماهنگی با ربات‌ها:', error);
  }
};
// ==================[ پایان توابع هماهنگی ]==================

// دستورات ربات
bot.start((ctx) => {
  if (!checkRateLimit(ctx.from.id, 'start')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  ctx.reply('ناظر اکلیس در خدمت شماست 🥷🏻');
  logAction('bot_started', ctx.from.id);
});

// دستور فعال‌سازی گروه
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

  if (!(await isChatAdmin(chatId, userId))) {
    ctx.reply('فقط ادمین‌های گروه می‌توانند ربات را فعال کنند.');
    return;
  }

  const botIsAdmin = await isBotAdmin(chatId);
  logger.info(`بررسی ادمین بودن ربات در گروه ${chatId}: ${botIsAdmin}`);
  
  if (!botIsAdmin) {
    ctx.reply('لطفاً ابتدا ربات را ادمین گروه کنید.');
    return;
  }

  try {
    const { error } = await supabase
      .from('allowed_chats')
      .upsert({
        chat_id: chatId,
        chat_title: ctx.chat.title,
        created_at: new Date().toISOString()
      }, { onConflict: 'chat_id' });

    if (error) {
      logger.error('خطا در فعال‌سازی گروه:', error);
      ctx.reply('خطا در فعال‌سازی گروه.');
      return;
    }

    ctx.reply('✅ ربات با موفقیت فعال شد! از این پس کاربران جدید قرنطینه خواهند شد.');
    await logAction('chat_activated', userId, chatId, {
      chat_title: ctx.chat.title
    });
  } catch (error) {
    logger.error('خطا در فعال‌سازی گروه:', error);
    ctx.reply('خطا در فعال‌سازی گروه.');
  }
});

// دستور غیرفعال‌سازی گروه
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

  if (!(await isChatAdmin(chatId, userId))) {
    ctx.reply('فقط ادمین‌های گروه می‌توانند ربات را غیرفعال کنند.');
    return;
  }

  try {
    const { error } = await supabase
      .from('allowed_chats')
      .delete()
      .eq('chat_id', chatId);

    if (error) {
      logger.error('خطا در غیرفعال‌سازی گروه:', error);
      ctx.reply('خطا در غیرفعال‌سازی گروه.');
      return;
    }

    ctx.reply('❌ ربات با موفقیت غیرفعال شد! از این پس کاربران جدید قرنطینه نخواهند شد.');
    await logAction('chat_deactivated', userId, chatId, {
      chat_title: ctx.chat.title
    });
  } catch (error) {
    logger.error('خطا در غیرفعال‌سازی گروه:', error);
    ctx.reply('خطا در غیرفعال‌سازی گروه.');
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
      ctx.reply('❌ ربات در این گروه غیرفعال است. برای فعال‌سازی از دستور /فعال استفاده کنید.');
    }
  } catch (error) {
    logger.error('خطا در بررسی وضعیت:', error);
    ctx.reply('خطا در بررسی وضعیت ربات.');
  }
});

// دستور راهنما
bot.command('راهنما', (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'help')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  const helpText = `
🤖 راهنمای ربات قرنطینه:

/فعال - فعال‌سازی ربات در گروه (فقط ادمین‌ها)
/غیرفعال - غیرفعال‌سازی ربات در گروه (فقط ادمین‌ها)
/وضعیت - نمایش وضعیت ربات در گروه
/راهنما - نمایش این راهنما

🔗 سیستم هماهنگی: ربات‌ها از API برای هماهنگی استفاده می‌کنند
🔄 شناسایی متقابل: کاربران در یک گروه قرنطینه و از گروه‌های دیگر حذف می‌شوند
🚨 اطلاع‌رسانی: در صورت تخلف کاربران قرنطینه شده، به مالک اطلاع داده می‌شود
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
          'برای فعال‌سازی و شروع قرنطینه کاربران جدید، از دستور /فعال استفاده کنید.\n' +
          'برای غیرفعال‌سازی از دستور /غیرفعال استفاده کنید.'
        );
      } else if (!member.is_bot) {
        await handleNewUser(ctx, member);
      }
    }
  } catch (error) {
    logger.error('خطا در پردازش عضو جدید:', error);
  }
});

// ==================[ endpointهای جدید و بهینه شده ]==================
app.post('/api/release-user', async (req, res) => {
  try {
    const { userId, secretKey, sourceBot } = req.body;
    
    // بررسی کلید امنیتی
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
    cache.del(`quarantine:${userId}`);
    
    // هماهنگی با سایر ربات‌ها (اگر فعال باشد)
    if (SYNC_ENABLED && sourceBot !== SELF_BOT_ID) {
      await syncWithOtherBots(userId, sourceBot);
    }
    
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

// ==================[ endpoint جدید: بررسی وضعیت کاربر ]==================
app.get('/api/check-user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // بررسی کلید امنیتی از هدر
    const authHeader = req.headers.authorization;
    const secretKey = authHeader?.replace('Bearer ', '');
    
    if (!secretKey || secretKey !== process.env.API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // بررسی کاربر در دیتابیس محلی
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
    
    res.status(200).json({
      success: true,
      user_id: parseInt(userId),
      is_quarantined: !!user,
      current_chat_id: user?.current_chat_id || null,
      username: user?.username || null,
      first_name: user?.first_name || null,
      checked_by: SELF_BOT_ID
    });
  } catch (error) {
    logger.error('خطا در endpoint بررسی کاربر:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/bot-status', (req, res) => {
  // دریافت آمار کش
  const cacheStats = cache.getStats();
  const memoryUsage = process.memoryUsage();
  
  res.status(200).json({
    status: 'online',
    botId: SELF_BOT_ID,
    type: 'quarantine',
    timestamp: new Date().toISOString(),
    connectedBots: BOT_INSTANCES.length,
    version: '3.6.0',
    database: 'separate',
    features: ['multi-bot-api-sync', 'separate-database', 'cross-bot-check', 'owner-violation-alerts'],
    cache: {
      keys: cacheStats.keys,
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate: Math.round((cacheStats.hits / (cacheStats.hits + cacheStats.misses || 1)) * 100) + '%',
      size: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB'
    }
  });
});

app.post('/api/sync-release', async (req, res) => {
  try {
    const { userId, secretKey, sourceBot } = req.body;
    
    // بررسی کلید امنیتی
    if (!secretKey || secretKey !== process.env.API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log(`🔄 درخواست هماهنگی از ${sourceBot} برای کاربر ${userId}`);
    
    // آزاد کردن کاربر در این ربات
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
    
    // پاک کردن کش
    cache.del(`quarantine:${userId}`);
    
    logger.info(`کاربر ${userId} از طریق هماهنگی با ${sourceBot} آزاد شد`);
    res.status(200).json({
      success: true,
      botId: SELF_BOT_ID,
      processed: true,
      message: `کاربر ${userId} آزاد شد`
    });
  } catch (error) {
    logger.error('❌ خطا در پردازش هماهنگی:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// ==================[ پایان endpointهای جدید ]==================

// وب سرور
app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => res.send('ربات قرنطینه فعال است! (سیستم هماهنگی API + اطلاع‌رسانی تخلف)'));
app.get('/health', (req, res) => res.status(200).json({ 
  status: 'OK', 
  database: 'separate',
  features: ['caching', 'violation_alerts', 'multi-bot-sync']
}));

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  console.log(`🤖 شناسه ربات: ${SELF_BOT_ID}`);
  console.log(`🔗 حالت هماهنگی: ${SYNC_ENABLED ? 'فعال' : 'غیرفعال'}`);
  console.log(`👥 تعداد ربات‌های متصل: ${BOT_INSTANCES.length}`);
  console.log(`🗃️ دیتابیس: جداگانه (${process.env.SUPABASE_URL})`);
  console.log(`💾 سیستم کشینگ: فعال (حداکثر ${cache.getStats().maxKeys} کلید)`);
  console.log(`🚨 سیستم اطلاع‌رسانی تخلف: فعال`);
  console.log(`✨ سیستم هماهنگی API با اطلاع‌رسانی فعال شد`);
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
