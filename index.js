const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const winston = require('winston');
const cron = require('node-cron');
const NodeCache = require('node-cache');
const helmet = require('helmet');
const cors = require('cors');
const redis = require('redis');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware امنیتی
app.use(helmet());
app.use(cors());
app.use(express.json());

// تنظیمات
const cache = new NodeCache({ stdTTL: 300, checkperiod: 600 });
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

// Redis Client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => logger.error('Redis Client Error:', err));
redisClient.connect();

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

// 🔔 تابع جدید: ارسال پیام به مالکان گروه هنگام تخلف
const notifyOwnersAboutViolation = async (chatId, violatingUser) => {
  try {
    const chatAdministrators = await bot.telegram.getChatAdministrators(chatId);
    const owner = chatAdministrators.find(admin => admin.status === 'creator');
    
    const userName = violatingUser.first_name || 'ناشناس';
    const userUsername = violatingUser.username ? `@${violatingUser.username}` : 'ندارد';
    
    const alertMessage = `⚠️ **هشدار تخلف قرنطینه**\n\n` +
                         `کاربر: ${userName} (آیدی: ${violatingUser.id})\n` +
                         `نام کاربری: ${userUsername}\n` +
                         `در حال تلاش برای پیوستن به گروه‌های دیگر است در حالی که هنوز در قرنطینه قرار دارد.`;

    // ارسال پیام به سازنده گروه
    if (owner) {
      try {
        await bot.telegram.sendMessage(owner.user.id, alertMessage, { parse_mode: 'Markdown' });
        logger.info(`پیام هشدار برای کاربر ${violatingUser.id} به مالک گروه ${chatId} ارسال شد`);
      } catch (error) {
        logger.error(`خطا در ارسال پیام به مالک ${owner.user.id}:`, error);
      }
    }
    
    // ارسال پیام به سایر ادمین‌ها (اختیاری)
    for (const admin of chatAdministrators) {
      if (admin.status === 'administrator' && admin.user.id !== owner.user.id) {
        try {
          await bot.telegram.sendMessage(admin.user.id, alertMessage, { parse_mode: 'Markdown' });
        } catch (error) {
          logger.error(`خطا در ارسال پیام به ادمین ${admin.user.id}:`, error);
        }
      }
    }
  } catch (error) {
    logger.error('خطا در ارسال پیام به مالکان:', error);
  }
};

// 🗑️ تابع جدید: حذف خودکار پیام‌های سیستم
const deleteSystemMessage = async (ctx) => {
  try {
    await ctx.deleteMessage();
    logger.info(`پیام سیستم در گروه ${ctx.chat.id} حذف شد`);
  } catch (error) {
    if (error.response && error.response.error_code === 400) {
      logger.warn('پیام قبلاً حذف شده یا دسترسی وجود ندارد');
    } else {
      logger.error('خطا در حذف پیام سیستم:', error);
    }
  }
};

// توابع کمکی موجود
const logAction = async (action, userId, chatId = null, details = {}) => {
  try {
    await supabase.from('action_logs').insert({
      action, user_id: userId, chat_id: chatId, details, created_at: new Date().toISOString()
    });
  } catch (error) {
    logger.error('خطا در ثبت فعالیت:', error);
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
    return false;
  }
};

const isChatAdmin = async (chatId, userId) => {
  try {
    const cacheKey = `admin:${chatId}:${userId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    const redisKey = `admin:${chatId}:${userId}`;
    const redisCached = await redisClient.get(redisKey);
    if (redisCached !== null) {
      const result = redisCached === 'true';
      cache.set(cacheKey, result, 60);
      return result;
    }
    
    const member = await bot.telegram.getChatMember(chatId, userId);
    const isAdmin = ['administrator', 'creator'].includes(member.status);
    
    cache.set(cacheKey, isAdmin, 300);
    await redisClient.setEx(redisKey, 300, isAdmin.toString());
    
    return isAdmin;
  } catch (error) {
    logger.error('خطا در بررسی ادمین:', error);
    return false;
  }
};

const getUserStatus = async (chatId, userId) => {
  try {
    const cacheKey = `userstatus:${chatId}:${userId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    const member = await bot.telegram.getChatMember(chatId, userId);
    cache.set(cacheKey, member.status, 300);
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

const removeUserFromAllOtherChats = async (currentChatId, userId) => {
  try {
    const cacheKey = 'allowed_chats';
    let allChats = cache.get(cacheKey);
    
    if (!allChats) {
      const { data, error } = await supabase.from('allowed_chats').select('chat_id');
      if (error) {
        logger.error('خطا در دریافت گروه‌ها:', error);
        return;
      }
      allChats = data || [];
      cache.set(cacheKey, allChats, 600);
    }
    
    if (allChats.length > 0) {
      for (const chat of allChats) {
        if (chat.chat_id.toString() !== currentChatId.toString()) {
          await removeUserFromChat(chat.chat_id, userId);
        }
      }
    }
  } catch (error) {
    logger.error('خطا در حذف کاربر از گروه‌های دیگر:', error);
  }
};

const handleNewUser = async (ctx, user) => {
  try {
    const cacheKey = `allowed_chat:${ctx.chat.id}`;
    let allowedChat = cache.get(cacheKey);
    
    if (!allowedChat) {
      const { data } = await supabase
        .from('allowed_chats')
        .select('chat_id')
        .eq('chat_id', ctx.chat.id.toString())
        .single();
      
      allowedChat = data;
      cache.set(cacheKey, data, 600);
    }

    if (!allowedChat) return;

    const now = new Date().toISOString();
    const userCacheKey = `quarantine_user:${user.id}`;
    let existingUser = cache.get(userCacheKey);
    
    if (!existingUser) {
      const { data } = await supabase
        .from('quarantine_users')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_quarantined', true)
        .single();
      
      existingUser = data;
      if (existingUser) {
        cache.set(userCacheKey, existingUser, 300);
      }
    }

    if (existingUser) {
      // 🔔 اطلاع‌رسانی تخلف کاربر
      await notifyOwnersAboutViolation(ctx.chat.id, user);
      
      if (existingUser.current_chat_id && existingUser.current_chat_id !== ctx.chat.id.toString()) {
        await removeUserFromChat(ctx.chat.id, user.id);
        await removeUserFromAllOtherChats(existingUser.current_chat_id, user.id);
        return;
      }
      
      await supabase
        .from('quarantine_users')
        .update({ username: user.username, first_name: user.first_name, updated_at: now })
        .eq('user_id', user.id);
    } else {
      await supabase.from('quarantine_users').upsert({
        user_id: user.id,
        username: user.username,
        first_name: user.first_name,
        is_quarantined: true,
        current_chat_id: ctx.chat.id.toString(),
        created_at: now,
        updated_at: now
      }, { onConflict: 'user_id' });
      
      cache.set(userCacheKey, {
        user_id: user.id,
        username: user.username,
        first_name: user.first_name,
        is_quarantined: true,
        current_chat_id: ctx.chat.id.toString()
      }, 300);
      
      await removeUserFromAllOtherChats(ctx.chat.id, user.id);
      await logAction('user_quarantined', user.id, ctx.chat.id, {
        username: user.username, first_name: user.first_name
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
        
        cache.del(`quarantine_user:${user.user_id}`);
        await redisClient.del(`quarantine_user:${user.user_id}`);
        
        await logAction('quarantine_expired', user.user_id, null, {
          username: user.username, first_name: user.first_name
        });
      }
    }
  } catch (error) {
    logger.error('خطا در بررسی انقضای قرنطینه:', error);
  }
};

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

    cache.del('allowed_chats');
    cache.del(`allowed_chat:${chatId}`);
    await redisClient.del('allowed_chats');
    
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

    cache.del('allowed_chats');
    cache.del(`allowed_chat:${chatId}`);
    await redisClient.del('allowed_chats');
    
    ctx.reply('❌ ربات با موفقیت غیرفعال شد! از این پس کاربران جدید قرنطینه نخواهند شد.');
    await logAction('chat_deactivated', userId, chatId, {
      chat_title: ctx.chat.title
    });
  } catch (error) {
    logger.error('خطا در غیرفعال‌سازی گروه:', error);
    ctx.reply('خطا در غیرفعال‌سازی گروه.');
  }
});

// سایر دستورات موجود...
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
    const cacheKey = `allowed_chat:${chatId}`;
    let allowedChat = cache.get(cacheKey);
    
    if (!allowedChat) {
      const { data } = await supabase
        .from('allowed_chats')
        .select('chat_id')
        .eq('chat_id', chatId)
        .single();
      
      allowedChat = data;
      cache.set(cacheKey, data, 600);
    }

    if (allowedChat) {
      ctx.reply('✅ ربات در این گروه فعال است و کاربران جدید را قرنطینه می‌کند.');
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
🤖 راهنمای ربات قرنطینه:

/on - فعال‌سازی ربات در گروه (فقط ادمین‌ها)
/off - غیرفعال‌سازی ربات در گروه (فقط ادمین‌ها)  
/status - نمایش وضعیت ربات در گروه
/راهنما - نمایش این راهنما

پس از فعال‌سازی، کاربران جدید به صورت خودکار قرنطینه می‌شوند و فقط در یک گروه می‌توانند عضو باشند.
  `;
  
  ctx.reply(helpText);
  logAction('help_requested', ctx.from.id);
});

// 🗑️ پردازش پیام‌های سیستم - حذف خودکار
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
    
    // 🗑️ حذف پیام سیستم پس از پردازش
    await deleteSystemMessage(ctx);
  } catch (error) {
    logger.error('خطا در پردازش عضو جدید:', error);
  }
});

// 🗑️ پردازش پیام‌های خروج کاربران
bot.on('left_chat_member', async (ctx) => {
  try {
    // 🗑️ حذف پیام سیستم خروج
    await deleteSystemMessage(ctx);
  } catch (error) {
    logger.error('خطا در پردازش خروج کاربر:', error);
  }
});

// endpoint برای آزادسازی کاربر از طریق API
app.post('/api/release-user', async (req, res) => {
  try {
    const { userId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== process.env.API_SECRET_KEY) {
      logger.warn('درخواست غیرمجاز برای آزادسازی کاربر');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
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
    
    cache.del(`quarantine_user:${userId}`);
    await redisClient.del(`quarantine_user:${userId}`);
    
    logger.info(`کاربر ${userId} از طریق API از قرنطینه خارج شد`);
    res.status(200).json({ 
      success: true,
      message: `User ${userId} released from quarantine`
    });
  } catch (error) {
    logger.error('خطا در endpoint آزاد کردن کاربر:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// وب سرور
app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => res.send('ربات قرنطینه فعال است!'));
app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));

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
