const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const winston = require('winston');
const cron = require('node-cron');
const NodeCache = require('node-cache');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware امنیتی
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// تنظیمات
const cache = new NodeCache({ 
  stdTTL: 300, 
  checkperiod: 600,
  maxKeys: 1000
});
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: 'error.log', 
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3
    }),
    new winston.transports.File({ 
      filename: 'combined.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 2
    })
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

// پاکسازی دوره‌ای کش
setInterval(() => {
  cache.keys().forEach(key => {
    if (key.startsWith('admin:') || key.startsWith('allowed_admin:')) {
      cache.del(key);
    }
  });
}, 10 * 60 * 1000);

// توابع کمکی
const logAction = async (action, userId, chatId = null, details = {}) => {
  try {
    const compressedDetails = JSON.stringify(details);
    
    await supabase.from('action_logs').insert({
      action, 
      user_id: userId, 
      chat_id: chatId, 
      details: compressedDetails, 
      created_at: new Date().toISOString()
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
    logger.error('خطا در بررسی ادمین بودن ربات:', error);
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

const removeUserFromAllOtherChats = async (currentChatId, userId) => {
  try {
    const { data: allChats, error } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('is_active', true);
    
    if (error) return logger.error('خطا در دریافت گروه‌ها:', error);
    
    if (allChats?.length > 0) {
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

const isGroupActive = async (chatId) => {
  try {
    const cacheKey = `active_chat:${chatId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    const { data, error } = await supabase
      .from('allowed_chats')
      .select('is_active')
      .eq('chat_id', chatId.toString())
      .single();
    
    const isActive = data?.is_active || false;
    cache.set(cacheKey, isActive, 300);
    return isActive;
  } catch (error) {
    logger.error('خطا در بررسی وضعیت گروه:', error);
    return false;
  }
};

const handleNewUser = async (ctx, user) => {
  try {
    // بررسی اینکه گروه فعال است یا نه
    const isActive = await isGroupActive(ctx.chat.id);
    if (!isActive) {
      logger.info(`گروه ${ctx.chat.id} غیرفعال است، کاربر قرنطینه نمی‌شود`);
      return;
    }
    
    const now = new Date().toISOString();
    
    const { data: existingUser } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_quarantined', true)
      .single();

    if (existingUser) {
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

bot.on('new_chat_members', async (ctx) => {
  try {
    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot && member.username === ctx.botInfo.username) {
        if (!(await isChatAdmin(ctx.chat.id, ctx.message.from.id))) {
          await ctx.leaveChat();
          return;
        }
        
        // ربات به گروه اضافه شده - فقط ذخیره اطلاعات گروه
        await supabase.from('allowed_chats').upsert({
          chat_id: ctx.chat.id.toString(),
          chat_title: ctx.chat.title,
          is_active: false, // پیش‌فرض غیرفعال
          created_at: new Date().toISOString()
        }, { onConflict: 'chat_id' });
        
        await logAction('bot_added_to_chat', ctx.message.from.id, ctx.chat.id, {
          chat_title: ctx.chat.title
        });
        
        ctx.reply('🤖 ربات با موفقیت به گروه اضافه شد. برای فعال‌سازی قرنطینه از دستور #فعال استفاده کنید.');
      } else if (!member.is_bot) {
        // کاربر عادی به گروه اضافه شده - قرنطینه اتوماتیک
        await handleNewUser(ctx, member);
      }
    }
  } catch (error) {
    logger.error('خطا در پردازش عضو جدید:', error);
  }
});

// دستور #فعال برای ثبت گروه در دیتابیس
bot.hears('#فعال', async (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'activate')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  try {
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) {
      ctx.reply('❌ فقط ادمین‌های گروه می‌توانند از این دستور استفاده کنند.');
      return;
    }
    
    const { error } = await supabase
      .from('allowed_chats')
      .upsert({
        chat_id: ctx.chat.id.toString(),
        chat_title: ctx.chat.title,
        is_active: true,
        activated_by: ctx.from.id,
        activated_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'chat_id' });
    
    if (error) {
      logger.error('خطا در فعال کردن گروه:', error);
      ctx.reply('❌ خطا در فعال کردن گروه. لطفاً لاگ‌ها را بررسی کنید.');
      return;
    }
    
    // پاک کردن کش وضعیت گروه
    cache.del(`active_chat:${ctx.chat.id}`);
    
    ctx.reply('✅ منطقه فعال شد! از این پس کاربران جدید به طور خودکار قرنطینه می‌شوند.');
    await logAction('chat_activated', ctx.from.id, ctx.chat.id, {
      chat_title: ctx.chat.title
    });
  } catch (error) {
    logger.error('خطا در دستور فعال:', error);
    ctx.reply('❌ خطایی در پردازش دستور رخ داده است.');
  }
});

// دستور #غیرفعال برای حذف گروه از دیتابیس
bot.hears('#غیرفعال', async (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'deactivate')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  try {
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) {
      ctx.reply('❌ فقط ادمین‌های گروه می‌توانند از این دستور استفاده کنند.');
      return;
    }
    
    // غیرفعال کردن گروه (حذف از دیتابیس)
    const { error } = await supabase
      .from('allowed_chats')
      .delete()
      .eq('chat_id', ctx.chat.id.toString());
    
    if (error) {
      logger.error('خطا در غیرفعال کردن گروه:', error);
      ctx.reply('❌ خطا در غیرفعال کردن گروه. لطفاً لاگ‌ها را بررسی کنید.');
      return;
    }
    
    // پاک کردن کش وضعیت گروه
    cache.del(`active_chat:${ctx.chat.id}`);
    
    ctx.reply('✅ منطقه غیرفعال شد! کاربران جدید قرنطینه نخواهند شد.');
    await logAction('chat_deactivated', ctx.from.id, ctx.chat.id, {
      chat_title: ctx.chat.title
    });
  } catch (error) {
    logger.error('خطا در دستور غیرفعال:', error);
    ctx.reply('❌ خطایی در پردازش دستور رخ داده است.');
  }
});

// دستور #حذف برای خارج کردن کاربر از قرنطینه (ریپلای روی کاربر)
bot.hears('#حذف', async (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'remove_user')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  try {
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) {
      ctx.reply('❌ فقط ادمین‌های گروه می‌توانند از این دستور استفاده کنند.');
      return;
    }
    
    if (!ctx.message.reply_to_message) {
      ctx.reply('❌ لطفاً روی پیام کاربر مورد نظر ریپلای کنید.');
      return;
    }
    
    const targetUser = ctx.message.reply_to_message.from;
    
    // بررسی آیا کاربر در قرنطینه است
    const { data: quarantinedUser, error: queryError } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', targetUser.id)
      .eq('is_quarantined', true)
      .single();
    
    if (queryError || !quarantinedUser) {
      ctx.reply('❌ این کاربر در قرنطینه نیست یا قبلاً آزاد شده است.');
      return;
    }
    
    // خارج کردن کاربر از قرنطینه
    const { error } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        released_by: ctx.from.id,
        released_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('user_id', targetUser.id);
      
    if (error) {
      logger.error('خطا در خارج کردن کاربر از قرنطینه:', error);
      ctx.reply('❌ خطا در خارج کردن کاربر از قرنطینه.');
      return;
    }
    
    // پاک کردن کش کاربر
    cache.del(`quarantine:${targetUser.id}`);
    
    ctx.reply(`✅ کاربر ${targetUser.first_name} (@${targetUser.username || 'بدون یوزرنیم'}) با موفقیت از قرنطینه خارج شد.`);
    
    await logAction('user_released_by_admin', ctx.from.id, ctx.chat.id, {
      target_user_id: targetUser.id,
      target_username: targetUser.username,
      target_first_name: targetUser.first_name
    });
  } catch (error) {
    logger.error('خطا در پردازش دستور حذف:', error);
    ctx.reply('❌ خطایی در پردازش دستور رخ داده است.');
  }
});

// پاکسازی داده‌های قدیمی
async function cleanupOldData() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    
    // حذف لاگ‌های قدیمی
    const { error: logsError } = await supabase
      .from('action_logs')
      .delete()
      .lt('created_at', thirtyDaysAgo);
    
    if (!logsError) {
      logger.info('لاگ‌های قدیمی با موفقیت پاکسازی شدند');
    }
    
    // حذف کاربران آزاد شده قدیمی
    const { error: usersError } = await supabase
      .from('quarantine_users')
      .delete()
      .eq('is_quarantined', false)
      .lt('updated_at', thirtyDaysAgo);
    
    if (!usersError) {
      logger.info('کاربران آزاد شده قدیمی با موفقیت پاکسازی شدند');
    }
  } catch (error) {
    logger.error('خطا در پاکسازی داده‌های قدیمی:', error);
  }
}

// زمان‌بندی پاکسازی هفتگی
cron.schedule('0 0 * * 0', () => {
  logger.info('شروع پاکسازی دوره‌ی داده‌های قدیمی');
  cleanupOldData();
});

// endpoint آزادسازی کاربر
app.post('/api/release-user', async (req, res) => {
  try {
    const { userId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== process.env.API_SECRET_KEY) {
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
    
    cache.del(`quarantine:${userId}`);
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
app.get('/health', (req, res) => {
  const memoryUsage = process.memoryUsage();
  res.status(200).json({ 
    status: 'OK', 
    memory: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB/${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`
  });
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Memory usage: ${JSON.stringify(process.memoryUsage())}`);
});

// فعال سازی وب هوک
if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => logger.info(`Webhook set to: ${webhookUrl}`))
    .catch(error => logger.error('Error setting webhook:', error));
} else {
  bot.launch();
}

// Graceful shutdown
process.once('SIGINT', () => {
  logger.info('Shutting down gracefully...');
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  logger.info('Shutting down gracefully...');
  bot.stop('SIGTERM');
  process.exit(0);
});

module.exports = app;
