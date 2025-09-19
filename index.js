const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const winston = require('winston');
const cron = require('node-cron');
const NodeCache = require('node-cache');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware امنیتی
app.use(helmet());
app.use(express.json());

// تنظیمات کش
const cache = new NodeCache({ stdTTL: 300, checkperiod: 600 });

// تنظیمات لاگینگ
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

// بررسی وجود متغیرهای محیطی ضروری
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_KEY', 'BOT_TOKEN'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`❌ متغیر محیطی ${envVar} تعریف نشده است`);
    process.exit(1);
  }
}

// تنظیمات Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// توکن ربات
const bot = new Telegraf(process.env.BOT_TOKEN);

// محدودیت نرخ درخواست
const rateLimit = new Map();

function checkRateLimit(userId, action, limit = 5, windowMs = 60000) {
  const key = `${userId}:${action}`;
  const now = Date.now();
  const userLimits = rateLimit.get(key) || [];
  
  const recentLimits = userLimits.filter(time => now - time < windowMs);
  
  if (recentLimits.length >= limit) {
    return false;
  }
  
  recentLimits.push(now);
  rateLimit.set(key, recentLimits);
  return true;
}

// تابع ثبت فعالیت
async function logAction(action, userId, chatId = null, details = {}) {
  try {
    await supabase
      .from('action_logs')
      .insert({
        action,
        user_id: userId,
        chat_id: chatId,
        details,
        created_at: new Date().toISOString()
      });
  } catch (error) {
    logger.error('خطا در ثبت فعالیت:', error);
  }
}

// تابع بررسی ادمین بودن با کش
async function isChatAdmin(chatId, userId) {
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
}

// تابع بررسی مالک بودن
async function isOwner(userId) {
  try {
    const cacheKey = `owner:${userId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    const { data, error } = await supabase
      .from('allowed_owners')
      .select('owner_id')
      .eq('owner_id', userId)
      .single();
    
    const isOwner = data !== null;
    cache.set(cacheKey, isOwner, 600);
    return isOwner;
  } catch (error) {
    logger.error('خطا در بررسی مالک:', error);
    return false;
  }
}

// تابع بررسی ادمین م��از - بهبود یافته
async function isAllowedAdmin(userId) {
  try {
    const cacheKey = `allowed_admin:${userId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    const { data, error } = await supabase
      .from('allowed_admins')
      .select('admin_id')
      .eq('admin_id', userId)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      logger.error('خطا در بررسی ادمین مجاز:', error);
      return false;
    }
    
    const isAllowed = data !== null;
    cache.set(cacheKey, isAllowed, 600);
    return isAllowed;
  } catch (error) {
    logger.error('خطا در بررسی ادمین مجاز:', error);
    return false;
  }
}

// تابع بررسی اینکه آیا ربات ادمین است
async function isBotAdmin(chatId) {
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
}

// تابع بررسی وضعیت کاربر در گروه
async function getUserStatus(chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return member.status;
  } catch (error) {
    if (error.response && error.response.error_code === 400) {
      return 'not_member';
    }
    logger.error('خطا در بررسی وضعیت کاربر:', error);
    return null;
  }
}

// تابع حذف کاربر از گروه (بدون بن) - بهبود یافته
async function removeUserFromChat(chatId, userId) {
  try {
    if (!(await isBotAdmin(chatId))) {
      logger.error('ربات در گروه ادمین نیست');
      return false;
    }
    
    const userStatus = await getUserStatus(chatId, userId);
    
    if (userStatus === 'not_member' || userStatus === 'left' || userStatus === 'kicked') {
      logger.info(`کاربر ${userId} از قبل در گروه ${chatId} نیست`);
      return true;
    }
    
    if (userStatus === 'creator') {
      logger.warn(`کاربر ${userId} مالک گروه است و نمی‌توان حذف کرد`);
      return false;
    }
    
    // ابتدا کاربر را برای 30 ثانیه بن می‌کنیم
    await bot.telegram.banChatMember(chatId, userId, {
      until_date: Math.floor(Date.now() / 1000) + 30
    });
    
    // سپس آنبن می‌کنیم تا کاربر بتواند دوباره به گروه بپیوندد
    await bot.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
    
    logger.info(`کاربر ${userId} از گروه ${chatId} حذف شد (بدون بن دائمی)`);
    return true;
  } catch (error) {
    if (error.response && error.response.description && error.response.description.includes("can't remove chat owner")) {
      logger.warn(`کاربر ${userId} مالک گروه است و نمی‌توان حذف کرد`);
      return false;
    }
    
    if (error.response && error.response.error_code === 400 && error.response.description.includes("user not found")) {
      logger.info(`کاربر ${userId} در گروه ${chatId} پیدا نشد`);
      return true;
    }
    
    logger.error('خطا در حذف کاربر از گروه:', error);
    return false;
  }
}

// تابع بررسی و حذف کاربر از تمام گروه‌های دیگر
async function removeUserFromAllOtherChats(currentChatId, userId) {
  try {
    const { data: allChats, error: chatsError } = await supabase
      .from('allowed_chats')
      .select('chat_id');
    
    if (chatsError) {
      logger.error('خطا در دریافت گروه‌ها:', chatsError);
      return;
    }
    
    if (allChats && allChats.length > 0) {
      logger.info(`حذف کاربر ${userId} از ${allChats.length} گروه به جز ${currentChatId}`);
      
      for (const chat of allChats) {
        if (chat.chat_id.toString() !== currentChatId.toString()) {
          try {
            logger.info(`تلاش برای حذف کاربر از گروه ${chat.chat_id}`);
            await removeUserFromChat(chat.chat_id, userId);
          } catch (error) {
            logger.error(`حذف از گروه ${chat.chat_id} ناموفق بود:`, error);
          }
        }
      }
    } else {
      logger.info('هیچ گروهی در دیتابیس ثبت نشده است');
    }
  } catch (error) {
    logger.error('خطا در حذف کاربر از گروه‌های دیگر:', error);
  }
}

// تابع پردازش کاربر جدید (قرنطینه اتوماتیک) - بهبود یافته
async function handleNewUser(ctx, user) {
  try {
    const now = new Date().toISOString();
    logger.info(`پردازش کاربر جدید: ${user.id} در گروه ${ctx.chat.id}`);
    
    // بررسی آیا کاربر در حال حاضر در قرنطینه است
    const { data: existingUser, error: queryError } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_quarantined', true)
      .single();

    if (queryError && queryError.code !== 'PGRST116') {
      logger.error('خطا در بررسی کارب�� موجود:', queryError);
      return;
    }

    if (existingUser) {
      logger.info(`کاربر ${user.id} از قبل در قرنطینه است`);
      
      // کاربر از قبل در قرنطینه است - حذف از گروه فعلی اگر گروه فعلی با گروه قرنطینه متفاوت است
      if (existingUser.current_chat_id && existingUser.current_chat_id !== ctx.chat.id.toString()) {
        logger.info(`حذف کاربر از گروه فعلی ${ctx.chat.id} زیرا قبلاً در گروه ${existingUser.current_chat_id} قرنطینه شده`);
        await removeUserFromChat(ctx.chat.id, user.id);
        
        // حذف کاربر از تمام گروه‌های دیگر به جز گروه قرنطینه اصلی
        await removeUserFromAllOtherChats(existingUser.current_chat_id, user.id);
        return;
      }
      
      // کاربر در همان گروه قرنطینه است - به روز رسانی اطلاعات
      const { error: updateError } = await supabase
        .from('quarantine_users')
        .update({ 
          username: user.username,
          first_name: user.first_name,
          updated_at: now
        })
        .eq('user_id', user.id);
        
      if (updateError) {
        logger.error('خطا در به روز رسانی کاربر:', updateError);
      }
        
    } else {
      // کاربر جدید - قرنطینه اتوماتیک
      logger.info(`کاربر ${user.id} جدید است، افزودن به قرنطینه`);
      
      const { error: insertError } = await supabase
        .from('quarantine_users')
        .upsert({
          user_id: user.id,
          username: user.username,
          first_name: user.first_name,
          is_quarantined: true,
          current_chat_id: ctx.chat.id.toString(),
          created_at: now,
          updated_at: now
        }, { onConflict: 'user_id' });
      
      if (insertError) {
        logger.error('خطا در ذخیره کاربر در قرنطینه:', insertError);
        return;
      }
      
      // کاربر از تمام گروه‌های دیگر حذف شود
      logger.info(`حذف کاربر ${user.id} از سایر گروه‌ها به جز ${ctx.chat.id}`);
      await removeUserFromAllOtherChats(ctx.chat.id, user.id);
      
      // ثبت فعالیت
      await logAction('user_quarantined', user.id, ctx.chat.id, {
        username: user.username,
        first_name: user.first_name
      });
    }
  } catch (error) {
    logger.error('خطا در پردازش کاربر جدید:', error);
  }
}

// تابع بررسی انقضای قرنطینه
async function checkQuarantineExpiry() {
  try {
    const { data: expiredUsers, error } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('is_quarantined', true)
      .lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    
    if (expiredUsers && expiredUsers.length > 0) {
      logger.info(`پیدا کردن ${expiredUsers.length} کاربر با قرنطینه منقضی شده`);
      
      for (const user of expiredUsers) {
        await supabase
          .from('quarantine_users')
          .update({ 
            is_quarantined: false,
            current_chat_id: null,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user.user_id);
          
        logger.info(`قرنطینه کاربر ${user.user_id} به علت انقضا پایان یافت`);
        
        // ثبت فعالیت
        await logAction('quarantine_expired', user.user_id, null, {
          username: user.username,
          first_name: user.first_name
        });
      }
    }
  } catch (error) {
    logger.error('خطا در بررسی انقضای قرنطینه:', error);
  }
}

// API برای آزاد کردن کاربر از قرنطینه توسط ربات دیگر
const API_SECRET = process.env.API_SECRET_KEY;

// میدلور برای بررسی احراز هویت API
const authenticateAPI = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader === `Bearer ${API_SECRET}`) {
    next();
  } else {
    res.status(401).json({ error: 'دسترسی غیرمجاز' });
  }
};

// endpoint برای آزاد کردن کاربر از قرنطینه
app.post('/api/release-user', authenticateAPI, async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'شناسه کاربر ضروری است' });
    }

    // بررسی وجود کاربر در قرنطینه
    const { data: quarantinedUser, error: queryError } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', userId)
      .eq('is_quarantined', true)
      .single();

    if (queryError || !quarantinedUser) {
      return res.status(404).json({ error: 'کاربر در قرنطینه نیست' });
    }

    // آزاد کردن کاربر از قرنطینه
    const { error } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) {
      return res.status(500).json({ error: 'خطا در آزاد کردن کاربر' });
    }

    // پاک کردن کش کاربر
    cache.del(`quarantine:${userId}`);

    // ثبت لاگ
    await logAction('user_released_by_trigger_bot', null, null, {
      target_user_id: userId,
      released_by: 'trigger_bot'
    });

    res.json({ success: true, message: 'کاربر آزاد شد' });
  } catch (error) {
    logger.error('خطا در API آزاد کردن کاربر:', error);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// دستور /start
bot.start((ctx) => {
  if (!checkRateLimit(ctx.from.id, 'start')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  ctx.reply('ناظر اکلیس در خدمت شماست 🥷🏻');
  logAction('bot_started', ctx.from.id);
});

// دستور /list - جایگزین #لیست
bot.command('list', async (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'list_command')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  logger.info(`دریافت دستور /list از کاربر ${ctx.from.id}`);
  
  // بررسی آیا کاربر ادمین مجاز است
  const isAdmin = await isAllowedAdmin(ctx.from.id);
  logger.info(`کاربر ${ctx.from.id} isAllowedAdmin: ${isAdmin}`);
  
  if (!isAdmin) {
    logger.warn(`کاربر ${ctx.from.id} سعی در استفاده از دستور /list بدون مجوز دارد`);
    ctx.reply('شما مجوز استفاده از این دستور را ندارید. فقط ادمین‌های مجاز می‌توانند از /list استفاده کنند.');
    return;
  }
  
  // بررسی آیا پیام ریپلای است
  if (!ctx.message.reply_to_message) {
    ctx.reply('لطفاً روی پیام کاربر مورد نظر ریپلای کنید و سپس /list را وارد کنید.');
    return;
  }
  
  const targetUser = ctx.message.reply_to_message.from;
  logger.info(`پردازش دستور /list برای کاربر ${targetUser.id} (${targetUser.first_name})`);
  
  // بررسی آیا کاربر در قرنطینه است
  const { data: quarantinedUser, error: queryError } = await supabase
    .from('quarantine_users')
    .select('*')
    .eq('user_id', targetUser.id)
    .eq('is_quarantined', true)
    .single();
  
  if (queryError && queryError.code !== 'PGRST116') {
    logger.error('خطا در بررسی کاربر قرنطینه:', queryError);
    ctx.reply('خطا در بررسی وضعیت کاربر. لطفاً لاگ‌ها را بررسی کنید.');
    return;
  }
  
  if (!quarantinedUser) {
    ctx.reply('این کاربر در قرنطینه نیست یا قبلاً آزاد شده است.');
    return;
  }
  
  // خارج کردن کاربر از قرنطینه (بدون حذف از گروه)
  const { error } = await supabase
    .from('quarantine_users')
    .update({ 
      is_quarantined: false,
      current_chat_id: null,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', targetUser.id);
    
  if (error) {
    logger.error('خطا در خارج کردن کاربر از قرنطینه:', error);
    ctx.reply('❌ خطا در خارج کردن کاربر از قرنطینه. لطفاً لاگ‌ها را بررسی کنید.');
    return;
  }
  
  // پاک کردن کش کاربر
  cache.del(`quarantine:${targetUser.id}`);
  
  logger.info(`کاربر ${targetUser.id} توسط ادمین مجاز از قرنطینه خارج شد`);
  
  // ثبت فعالیت
  await logAction('user_released_by_admin', ctx.from.id, null, {
    target_user_id: targetUser.id,
    target_username: targetUser.username,
    target_first_name: targetUser.first_name
  });
  
  // پاسخ به ادمین مجاز
  ctx.reply(`✅ کاربر ${targetUser.first_name} (@${targetUser.username || 'بدون یوزرنیم'}) با موفقیت از قرنطینه خارج شد.`);
});

// مدیریت اضافه شدن ربات به گروه
bot.on('new_chat_members', async (ctx) => {
  try {
    const newMembers = ctx.message.new_chat_members;
    logger.info(`اعضای جدید در گروه ${ctx.chat.id}: ${newMembers.length} نفر`);
    
    for (const member of newMembers) {
      if (member.is_bot && member.username === ctx.botInfo.username) {
        // ربات به گروه اضافه شده
        logger.info(`ربات به گروه ${ctx.chat.id} اضافه شد`);
        
        if (!(await isChatAdmin(ctx.chat.id, ctx.message.from.id))) {
          logger.info(`کاربر ${ctx.message.from.id} ادمین نیست، ربات گروه را ترک می‌کند`);
          await ctx.leaveChat();
          return;
        }
        
        // ذخیره گروه در دیتابیس
        const { error } = await supabase
          .from('allowed_chats')
          .upsert({
            chat_id: ctx.chat.id.toString(),
            chat_title: ctx.chat.title,
            created_at: new Date().toISOString()
          }, { onConflict: 'chat_id' });
          
        logger.info(`گroup ${ctx.chat.id} در دیتابیس ثبت شد`);
        await logAction('chat_activated', ctx.message.from.id, ctx.chat.id, {
          chat_title: ctx.chat.title
        });
          
      } else if (!member.is_bot) {
        // کاربر عادی به گروه اضافه شده - قرنطینه اتوماتیک
        logger.info(`کاربر عادی ${member.id} به گروه اضافه شد`);
        await handleNewUser(ctx, member);
      }
    }
  } catch (error) {
    logger.error('خطا در پردازش عضو جدید:', error);
  }
});

// دستور #فعال برای ثبت گروه
bot.hears('#فعال', async (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'activate')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  try {
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) return;
    
    const { error } = await supabase
      .from('allowed_chats')
      .upsert({
        chat_id: ctx.chat.id.toString(),
        chat_title: ctx.chat.title,
        created_at: new Date().toISOString()
      }, { onConflict: 'chat_id' });
    
    ctx.reply('منطقه فعال شد ✅');
    await logAction('chat_activated', ctx.from.id, ctx.chat.id, {
      chat_title: ctx.chat.title
    });
  } catch (error) {
    logger.error('خطا در دستور فعال:', error);
  }
});

// دستور #غیرفعال برای حذف گروه
bot.hears('#غیرفعال', async (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'deactivate')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  try {
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) return;
    
    const { error } = await supabase
      .from('allowed_chats')
      .delete()
      .eq('chat_id', ctx.chat.id.toString());
    
    ctx.reply('منطقه غیرفعال شد ❌');
    await logAction('chat_deactivated', ctx.from.id, ctx.chat.id, {
      chat_title: ctx.chat.title
    });
  } catch (error) {
    logger.error('خطا در دستور غیرفعال:', error);
  }
});

// دستور #ادمین - اضافه کردن ادمین جدید (فقط برای مالک‌ها)
bot.hears(/^#ادمین\s+(\d+)$/, async (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'add_admin')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  try {
    if (!(await isOwner(ctx.from.id))) return;
    
    const targetUserId = ctx.match[1];
    const now = new Date().toISOString();
    
    // اضافه کردن کاربر به لیست ادمین‌های مجاز
    const { error } = await supabase
      .from('allowed_admins')
      .upsert({
        admin_id: targetUserId,
        added_by: ctx.from.id,
        created_at: now,
        updated_at: now
      }, { onConflict: 'admin_id' });
    
    if (error) {
      logger.error('خطا در اضافه کردن ادمین:', error);
      ctx.reply('❌ خطا در اضافه کردن ادمین. لطفاً لاگ‌ها را بررسی کنید.');
      return;
    }
    
    // پاک کردن کش برای اطمینان از به روز رسانی
    cache.del(`allowed_admin:${targetUserId}`);
    
    ctx.reply(`✅ کاربر با آیدی ${targetUserId} به لیست ادمین‌های مجاز اضافه شد.`);
    await logAction('admin_added', ctx.from.id, null, {
      target_user_id: targetUserId
    });
  } catch (error) {
    logger.error('خطا در پردازش دستور ادمین:', error);
    ctx.reply('خطایی در پردازش دستور رخ داده است.');
  }
});

// دستور #حذف_ادمین - حذف ادمین (فقط برای مالک‌ها)
bot.hears(/^#حذف_ادمین\s+(\d+)$/, async (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'remove_admin')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  try {
    if (!(await isOwner(ctx.from.id))) return;
    
    const targetUserId = ctx.match[1];
    
    // حذف کاربر از لیست ادمین‌های مجاز
    const { error } = await supabase
      .from('allowed_admins')
      .delete()
      .eq('admin_id', targetUserId);
    
    if (error) {
      logger.error('خطا در حذف ادمین:', error);
      ctx.reply('❌ خطا در حذف ادمین. لطفاً لاگ‌ها را بررسی کنید.');
      return;
    }
    
    // پاک کردن کش برای اطمینان از به روز رسانی
    cache.del(`allowed_admin:${targetUserId}`);
    
    ctx.reply(`✅ کاربر با آیدی ${targetUserId} از لیست ادمین‌های مجاز حذف شد.`);
    await logAction('admin_removed', ctx.from.id, null, {
      target_user_id: targetUserId
    });
  } catch (error) {
    logger.error('خطا در پردازش دستور حذف ادمین:', error);
    ctx.reply('خطایی در پردازش دستور رخ داده است.');
  }
});

// دستور #حذف برای ادمین‌های گروه (ریپلای روی کاربر)
bot.hears('#حذف', async (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'remove_command')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  try {
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) return;
    
    // بررسی آیا پیام ریپلای است
    if (!ctx.message.reply_to_message) {
      ctx.reply('لطفاً روی پیام کاربر مورد نظر ریپلای کنید.');
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
      ctx.reply('این کاربر در قرنطینه نیست.');
      return;
    }
    
    const { error } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', targetUser.id);
      
    if (!error) {
      // پاک کردن کش کاربر
      cache.del(`quarantine:${targetUser.id}`);
      
      ctx.reply(`کاربر ${targetUser.first_name} از قرنطینه خارج شد.`);
      await logAction('user_released_by_admin', ctx.from.id, ctx.chat.id, {
        target_user_id: targetUser.id,
        target_username: targetUser.username,
        target_first_name: targetUser.first_name
      });
    } else {
      ctx.reply('خطا در خارج کردن کاربر از قرنطینه.');
    }
  } catch (error) {
    logger.error('خطا در پردازش دستور حذف:', error);
  }
});

// دستور #حذف برای مالک‌ها (با آیدی کاربر)
bot.hears(/^#حذف\s+(\d+)$/, async (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'remove_by_id')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  try {
    if (!(await isOwner(ctx.from.id))) return;
    
    const targetUserId = ctx.match[1];
    
    // بررسی آیا کاربر در قرنطینه است
    const { data: quarantinedUser, error: queryError } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', targetUserId)
      .eq('is_quarantined', true)
      .single();
    
    if (queryError || !quarantinedUser) {
      ctx.reply('این کاربر در قرنطینه نیست.');
      return;
    }
    
    const { error } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', targetUserId);
      
    if (!error) {
      // پاک کردن کش کاربر
      cache.del(`quarantine:${targetUserId}`);
      
      ctx.reply(`کاربر با آیدی ${targetUserId} از قرنطینه خارج شد.`);
      await logAction('user_released_by_owner', ctx.from.id, null, {
        target_user_id: targetUserId
      });
    } else {
      ctx.reply('خطا در خارج کردن کاربر از قرنطینه.');
    }
  } catch (error) {
    logger.error('خطا در پردازش دستور حذف با آیدی:', error);
  }
});

// دستور #وضعیت برای مالک‌ها
bot.hears('#وضعیت', async (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'status')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  try {
    if (!(await isOwner(ctx.from.id))) return;
    
    const { data: chats, error: chatsError } = await supabase
      .from('allowed_chats')
      .select('*');
    
    const { data: users, error: usersError } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('is_quarantined', true);
    
    const { data: admins, error: adminsError } = await supabase
      .from('allowed_admins')
      .select('*');
    
    ctx.reply(`
📊 آمار ربات:
👥 گروه های فعال: ${chats?.length || 0}
🔒 کاربران قرنطینه: ${users?.length || 0}
👨‍💼 ادمین‌های مجاز: ${admins?.length || 0}
    `);
    
    await logAction('status_check', ctx.from.id);
  } catch (error) {
    logger.error('خطا در دستور وضعیت:', error);
  }
});

// دستور #راهنما
bot.hears('#راهنما', (ctx) => {
  if (!checkRateLimit(ctx.from.id, 'help')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  const helpText = `
🤖 راهنمای ربات قرنطینه:

#فعال - فعال کردن ربات در گروه
#غیرفعال - غیرفعال کردن ربات در گروه
#حذف (ریپلای) - حذف کاربر از قرنطینه (ادمین‌ها)
/list (ریپلای) - حذف کاربر از قرنطینه (فقط ادمین‌های مجاز)
#ادمین [آیدی] - اضافه کردن ادمین مجاز (فقط مالک)
#حذف_ادمین [آیدی] - حذف ادمین مجاز (فقط مالک)
#وضعیت - مشاهده آمار ربات (فقط مالک)
#راهنما - نمایش این راهنما
  `;
  
  ctx.reply(helpText);
  logAction('help_requested', ctx.from.id);
});

// وب سرور برای Render
app.use(bot.webhookCallback('/webhook'));

app.get('/', (req, res) => {
  res.send('ربات قرنطینه فعال است!');
});

app.get('/health', (req, res) => {
  const memoryUsage = process.memoryUsage();
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`
  });
});

app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res);
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

// فعال سازی بررسی انقضای قرنطینه (هر 6 ساعت یکبار)
cron.schedule('0 */6 * * *', () => {
  logger.info('بررسی خودکار انقضای قرنطینه آغاز شد');
  checkQuarantineExpiry();
});

// فعال سازی وب هوک
if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `https://${process.env.RENDER_EXTERNAL_URL.replace(/^https?:\/\//, '')}/webhook`;
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
