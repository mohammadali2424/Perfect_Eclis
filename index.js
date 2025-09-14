const { Telegraf, Scenes, session } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const winston = require('winston');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔥 ایجاد سیستم لاگ پیشرفته
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'telegram-bot' },
  transports: [
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// 🔥 مدیریت خطاهای全局
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// بررسی وجود متغیرهای محیطی
const requiredEnvVars = ['BOT_TOKEN', 'SUPABASE_URL', 'SUPABASE_KEY'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  logger.error('❌ Missing required environment variables:', missingEnvVars);
  process.exit(1);
}

// مقداردهی Supabase و Telegraf
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Telegraf(process.env.BOT_TOKEN);

// 🔥 بهبود سیستم کش با کلاس پیشرفته
class CacheManager {
  constructor(ttl = 5 * 60 * 1000) {
    this.cache = new Map();
    this.ttl = ttl;
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000); // پاکسازی هر دقیقه
  }

  /**
   * 📦 ذخیره مقدار در کش با کلید مشخص
   * @param {string} key - کلید ذخیره سازی
   * @param {any} value - مقدار برای ذخیره
   * @param {number} customTtl - زمان انقضای سفارشی (اختیاری)
   */
  set(key, value, customTtl = null) {
    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
      ttl: customTtl || this.ttl
    });
    logger.debug(`Cache SET: ${key}`);
  }

  /**
   * 📦 بازیابی مقدار از کش
   * @param {string} key - کلید برای بازیابی
   * @returns {any|null} مقدار ذخیره شده یا null
   */
  get(key) {
    if (!this.cache.has(key)) {
      logger.debug(`Cache MISS: ${key}`);
      return null;
    }
    
    const cached = this.cache.get(key);
    
    if (Date.now() - cached.timestamp > cached.ttl) {
      this.cache.delete(key);
      logger.debug(`Cache EXPIRED: ${key}`);
      return null;
    }
    
    logger.debug(`Cache HIT: ${key}`);
    return cached.data;
  }

  /**
   * 🗑️ حذف مقدار از کش
   * @param {string} key - کلید برای حذف
   */
  delete(key) {
    this.cache.delete(key);
    logger.debug(`Cache DELETE: ${key}`);
  }

  /**
   * 🧹 پاکسازی مقادیر منقضی شده از کش
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > value.ttl) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.debug(`Cache cleanup: Removed ${cleanedCount} expired items`);
    }
  }

  /**
   * 📊 دریافت آمار کش
   * @returns {Object} آمار شامل تعداد آیتم‌ها و حجم تقریبی
   */
  stats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * 🗑️ پاکسازی کامل کش
   */
  clear() {
    this.cache.clear();
    logger.debug('Cache CLEARED');
  }
}

const userCache = new CacheManager(5 * 60 * 1000); // 5 دقیقه TTL پیشفرض

// 🔥 تابع برای بررسی وضعیت قرنطینه کاربر
async function checkUserQuarantine(userId) {
  const cacheKey = `quarantine_${userId}`;
  
  const cached = userCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  
  try {
    const { data: quarantine, error } = await supabase
      .from('user_quarantine')
      .select('*')
      .eq('user_id', userId)
      .eq('is_quarantined', true)
      .single();

    if (error) {
      logger.error('Error checking user quarantine:', error);
      return null;
    }

    if (quarantine) {
      userCache.set(cacheKey, quarantine);
      return quarantine;
    }
    
    return null;
  } catch (error) {
    logger.error('Exception in checkUserQuarantine:', error);
    return null;
  }
}

// 🔥 تابع برای کیک کردن کاربر از گروه
async function kickUserFromGroup(chatId, userId, reason = 'قرنطینه فعال') {
  try {
    const botMember = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    const canKick = botMember.status === 'administrator' && botMember.can_restrict_members;
    
    if (!canKick) {
      logger.warn(`Bot cannot kick users in group ${chatId}`);
      return false;
    }
    
    await bot.telegram.kickChatMember(chatId, userId);
    logger.info(`User ${userId} kicked from group ${chatId} (${reason})`);
    
    setTimeout(async () => {
      try {
        await bot.telegram.unbanChatMember(chatId, userId);
        logger.debug(`User ${userId} unbanned from group ${chatId}`);
      } catch (unbanError) {
        logger.error('Error unbanning user:', unbanError);
      }
    }, 1000);
    
    return true;
  } catch (error) {
    logger.error(`Error kicking user ${userId}:`, error);
    return false;
  }
}

// 🔥 تابع برای کیک کردن کاربر از تمام گروه‌ها به جز گروه فعلی
async function kickUserFromAllGroupsExceptCurrent(userId, currentChatId) {
  try {
    const { data: groups, error: groupsError } = await supabase
      .from('groups')
      .select('chat_id, title')
      .eq('is_bot_admin', true);

    if (groupsError) {
      logger.error('Error fetching groups:', groupsError);
      return 0;
    }

    if (!groups || groups.length === 0) {
      return 0;
    }
    
    let kickedCount = 0;
    const kickPromises = [];
    
    for (const group of groups) {
      if (group.chat_id !== currentChatId) {
        kickPromises.push(
          kickUserFromGroup(group.chat_id, userId, 'قرنطینه فعال - انتقال به گروه جدید')
            .then(kicked => {
              if (kicked) kickedCount++;
              return kicked;
            })
        );
      }
    }
    
    await Promise.allSettled(kickPromises);
    logger.info(`User ${userId} kicked from ${kickedCount} groups`);
    return kickedCount;
  } catch (error) {
    logger.error('Error kicking user from all groups:', error);
    return 0;
  }
}

// 🔥 تابع برای ذخیره‌سازی پیام با entities و فرمت‌ها
async function saveMessageWithEntities(messageText, messageEntities) {
  if (!messageEntities || messageEntities.length === 0) {
    return { text: messageText, entities: [] };
  }

  const entities = messageEntities.map(entity => {
    const baseEntity = {
      type: entity.type,
      offset: entity.offset,
      length: entity.length
    };
    
    if (entity.url) baseEntity.url = entity.url;
    if (entity.user) baseEntity.user = entity.user;
    if (entity.language) baseEntity.language = entity.language;
    if (entity.custom_emoji_id) baseEntity.custom_emoji_id = entity.custom_emoji_id;
    
    return baseEntity;
  });

  return { text: messageText, entities };
}

// 🔥 تابع برای ارسال پیام با حفظ entities و فرمت‌ها
async function sendFormattedMessage(chatId, text, entities, replyToMessageId = null) {
  try {
    const messageOptions = {
      parse_mode: entities && entities.length > 0 ? undefined : 'HTML',
      disable_web_page_preview: false
    };

    if (replyToMessageId) {
      messageOptions.reply_to_message_id = replyToMessageId;
    }

    if (entities && entities.length > 0) {
      messageOptions.entities = entities;
    }

    await bot.telegram.sendMessage(chatId, text, messageOptions);
    return true;
  } catch (error) {
    logger.error('Error sending formatted message:', error);
    
    // Fallback: ارسال بدون entities
    try {
      await bot.telegram.sendMessage(
        chatId,
        text,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: false,
          reply_to_message_id: replyToMessageId
        }
      );
      return true;
    } catch (fallbackError) {
      logger.error('Fallback message sending also failed:', fallbackError);
      return false;
    }
  }
}

// 🔥 تابع برای تبدیل ثانیه به فرمت خوانا
function formatDelayTime(seconds) {
  if (seconds < 60) {
    return `${seconds} ثانیه`;
  } else {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 
      ? `${minutes} دقیقه و ${remainingSeconds} ثانیه` 
      : `${minutes} دقیقه`;
  }
}

// 🔥 تابع برای بررسی دسترسی ربات در گروه
async function checkBotAdminStatus(chatId) {
  try {
    const cacheKey = `bot_admin_${chatId}`;
    const cached = userCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const { data: group, error } = await supabase
      .from('groups')
      .select('is_bot_admin')
      .eq('chat_id', chatId)
      .single();

    if (!error && group) {
      userCache.set(cacheKey, group.is_bot_admin);
      return group.is_bot_admin;
    }

    try {
      const botMember = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
      const isAdmin = botMember.status === 'administrator' && botMember.can_restrict_members;
      
      await supabase
        .from('groups')
        .upsert({
          chat_id: chatId,
          is_bot_admin: isAdmin,
          last_updated: new Date().toISOString()
        });

      userCache.set(cacheKey, isAdmin);
      return isAdmin;
    } catch (tgError) {
      logger.error('Error checking bot admin status:', tgError);
      return false;
    }
  } catch (error) {
    logger.error('Error in checkBotAdminStatus:', error);
    return false;
  }
}

// 🔥 تابع برای بهینه‌سازی پرس‌و‌جوهای دیتابیس با صفحه‌بندی
async function getPaginatedData(table, page = 1, pageSize = 10, filters = {}) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  
  let query = supabase
    .from(table)
    .select('*', { count: 'exact' })
    .range(from, to);
  
  Object.entries(filters).forEach(([key, value]) => {
    query = query.eq(key, value);
  });
  
  const { data, error, count } = await query;
  
  if (error) {
    logger.error(`Error in paginated query for ${table}:`, error);
    throw error;
  }
  
  return { 
    data, 
    error, 
    total: count, 
    page, 
    pageSize,
    totalPages: Math.ceil(count / pageSize)
  };
}

// 🔥 تعریف سناریو برای تنظیمات تریگر (Wizard)
const setTriggerWizard = new Scenes.WizardScene(
  'set_trigger_wizard',
  async (ctx) => {
    try {
      await ctx.reply('🤖 لطفاً نام تریگر را وارد کنید:');
      return ctx.wizard.next();
    } catch (error) {
      logger.error('Error in setTriggerWizard step 1:', error);
      await ctx.reply('❌ خطایی رخ داد. لطفاً دوباره تلاش کنید.');
      return ctx.scene.leave();
    }
  },
  async (ctx) => {
    try {
      ctx.wizard.state.triggerName = ctx.message.text;
      await ctx.reply('⏰ لطفاً زمان تاخیر به ثانیه وارد کنید:');
      return ctx.wizard.next();
    } catch (error) {
      logger.error('Error in setTriggerWizard step 2:', error);
      await ctx.reply('❌ خطایی رخ داد. لطفاً دوباره تلاش کنید.');
      return ctx.scene.leave();
    }
  },
  async (ctx) => {
    try {
      const delaySeconds = parseInt(ctx.message.text);
      if (isNaN(delaySeconds) || delaySeconds <= 0) {
        await ctx.reply('⚠️ زمان باید یک عدد مثبت باشد. لطفاً دوباره وارد کنید:');
        return;
      }
      
      ctx.wizard.state.delaySeconds = delaySeconds;
      await ctx.reply('📩 لطفاً پیام تاخیری را وارد کنید (می‌توانید از لینک و فرمت استفاده کنید):');
      return ctx.wizard.next();
    } catch (error) {
      logger.error('Error in setTriggerWizard step 3:', error);
      await ctx.reply('❌ خطایی رخ داد. لطفاً دوباره تلاش کنید.');
      return ctx.scene.leave();
    }
  },
  async (ctx) => {
    try {
      ctx.wizard.state.secondMessage = ctx.message.text;
      ctx.wizard.state.secondMessageData = await saveMessageWithEntities(
        ctx.message.text,
        ctx.message.entities || ctx.message.caption_entities
      );
      
      const { error } = await supabase
        .from('trigger_settings')
        .upsert({
          chat_id: ctx.chat.id,
          trigger_name: ctx.wizard.state.triggerName,
          delay_seconds: ctx.wizard.state.delaySeconds,
          second_message: ctx.wizard.state.secondMessageData.text,
          second_message_entities: ctx.wizard.state.secondMessageData.entities
        });

      if (error) {
        logger.error('Error saving trigger settings:', error);
        await ctx.reply('❌ خطا در ذخیره تنظیمات.');
      } else {
        const formattedDelay = formatDelayTime(ctx.wizard.state.delaySeconds);
        await ctx.replyWithHTML(`✅ تنظیمات تریگر با موفقیت ذخیره شد!\n\n📋 خلاصه تنظیمات:\n<b>نام:</b> ${ctx.wizard.state.triggerName}\n<b>تاخیر:</b> ${formattedDelay}`);
      }
    } catch (error) {
      logger.error('Error in setTriggerWizard step 4:', error);
      await ctx.reply('❌ خطایی در ذخیره تنظیمات رخ داد.');
    }
    
    return ctx.scene.leave();
  }
);

// ثبت سناریو
const stage = new Scenes.Stage([setTriggerWizard]);
bot.use(session());
bot.use(stage.middleware());

// 🔥 هندلر جدید برای #فعال - ثبت گروه توسط ادمین
bot.hears(/.*#فعال.*/, async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const chatType = ctx.chat.type;
    const chatTitle = ctx.chat.title || 'بدون نام';

    if (chatType !== 'group' && chatType !== 'supergroup') {
      return ctx.reply('❌ این دستور فقط در گروه‌ها قابل استفاده است.');
    }

    try {
      const chatMember = await ctx.telegram.getChatMember(chatId, userId);
      const isAdmin = ['administrator', 'creator'].includes(chatMember.status);
      
      if (!isAdmin) {
        return ctx.reply('❌ فقط ادمین‌های گروه می‌توانند از این دستور استفاده کنند.');
      }
    } catch (error) {
      logger.error('Error checking admin status:', error);
      return ctx.reply('❌ خطا در بررسی وضعیت ادمینی.');
    }

    const botMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
    const isBotAdmin = botMember.status === 'administrator' && botMember.can_restrict_members;

    const { error } = await supabase
      .from('groups')
      .upsert({
        chat_id: chatId,
        title: chatTitle,
        type: chatType,
        is_bot_admin: isBotAdmin,
        last_updated: new Date().toISOString()
      });

    if (error) {
      logger.error('Error saving group:', error);
      return ctx.reply('❌ خطا در ثبت گروه. لطفاً بعداً تلاش کنید.');
    }

    await ctx.reply(`✅ گروه "${chatTitle}" با موفقیت در سیستم ثبت شد!`);
    logger.info(`Group registered: ${chatTitle} (${chatId}) by user ${userId}`);

  } catch (error) {
    logger.error('Error in #فعال command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// 🔥 هندلر تقویت شده برای زمانی که ربات به گروهی اضافه می‌شود
bot.on('my_chat_member', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const newStatus = ctx.update.my_chat_member.new_chat_member.status;
    const chatTitle = ctx.chat.title || 'بدون نام';
    const chatType = ctx.chat.type;

    if (chatType === 'group' || chatType === 'supergroup') {
      const isBotAdmin = newStatus === 'administrator';
      
      const { error } = await supabase
        .from('groups')
        .upsert({
          chat_id: chatId,
          title: chatTitle,
          type: chatType,
          is_bot_admin: isBotAdmin,
          last_updated: new Date().toISOString()
        });

      if (error) {
        logger.error('Error saving group status:', error);
      } else {
        logger.info(`Group status updated: ${chatTitle} (${chatId}) - Admin: ${isBotAdmin}`);
        userCache.delete(`bot_admin_${chatId}`);
      }
    }
  } catch (error) {
    logger.error('Error in my_chat_member handler:', error);
  }
});

// 🔥 هندلر تقویت شده برای کاربران جدید
bot.on('new_chat_members', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const chatTitle = ctx.chat.title || 'بدون نام';
    
    for (const newMember of ctx.message.new_chat_members) {
      const userId = newMember.id;
      
      if (newMember.is_bot) continue;

      const isBotAdmin = await checkBotAdminStatus(chatId);
      if (!isBotAdmin) {
        logger.warn(`Bot is not admin in group ${chatId}, cannot quarantine user`);
        continue;
      }

      await supabase
        .from('users')
        .upsert({
          chat_id: userId,
          first_name: newMember.first_name,
          username: newMember.username,
          last_name: newMember.last_name,
          updated_at: new Date().toISOString()
        });

      const quarantine = await checkUserQuarantine(userId);
      
      if (quarantine && quarantine.chat_id !== chatId) {
        await kickUserFromGroup(chatId, userId, 'کاربر در قرنطینه است');
        continue;
      }
      
      await supabase
        .from('user_quarantine')
        .upsert({
          user_id: userId,
          chat_id: chatId,
          is_quarantined: true,
          username: newMember.username,
          first_name: newMember.first_name,
          last_name: newMember.last_name,
          quarantine_start: new Date().toISOString(),
          quarantine_end: null
        });

      userCache.delete(`quarantine_${userId}`);
      await kickUserFromAllGroupsExceptCurrent(userId, chatId);
      
      logger.info(`User ${userId} quarantined in group ${chatTitle} (${chatId})`);
    }
  } catch (error) {
    logger.error('Error in new_chat_members handler:', error);
  }
});

// 🔥 هندلر برای بررسی کاربران قرنطینه هنگام ورود به گروه
bot.on('chat_member', async (ctx) => {
  try {
    const newMember = ctx.update.chat_member.new_chat_member;
    const userId = newMember.user.id;
    const chatId = ctx.chat.id;
    
    if (newMember.status === 'member' || newMember.status === 'administrator') {
      const quarantine = await checkUserQuarantine(userId);
      
      if (quarantine && quarantine.chat_id !== chatId) {
        const isBotAdmin = await checkBotAdminStatus(chatId);
        if (isBotAdmin) {
          await kickUserFromGroup(chatId, userId, 'کاربر در قرنطینه است');
        }
      }
    }
  } catch (error) {
    logger.error('Error in chat_member handler:', error);
  }
});

// 🔥 دستور start
bot.start(async (ctx) => {
  try {
    const chatId = ctx.message.chat.id;
    const firstName = ctx.message.chat.first_name || 'کاربر';
    const username = ctx.message.chat.username;

    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (existingUser) {
      await ctx.reply(`سلام ${firstName}! 😊`);
    } else {
      const { error } = await supabase
        .from('users')
        .insert([{ chat_id: chatId, first_name: firstName, username: username }]);

      if (error) {
        logger.error('Supabase insert error:', error);
        return ctx.reply('⚠️ مشکلی در ثبت اطلاعات پیش آمد. لطفاً بعداً تلاش کنید.');
      }

      await ctx.reply(`سلام ${firstName}! 😊`);
    }

    await ctx.replyWithHTML(`
🤖 <b>دستورات disponibles:</b>
/set_trigger - تنظیم تریگر جدید
#فعال - ثبت گروه در سیستم (فقط ادمین)
/list_triggers - مشاهده لیست تریگرها
/delete_trigger - حذف تریگر
/group_status - بررسی وضعیت گروه
/admin_g - ارتقای دسترسی ربات در گروه
    `);

  } catch (err) {
    logger.error('Error in /start command:', err);
    ctx.reply('❌ خطای غیرمنتظره‌ای رخ داد.');
  }
});

// 🔥 دستور set_trigger - شروع فرآیند تنظیمات
bot.command('set_trigger', (ctx) => {
  ctx.scene.enter('set_trigger_wizard');
});

// 🔥 تشخیص #ورود در هر جای متن
bot.hears(/.*#ورود.*/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const firstName = ctx.from.first_name || 'کاربر';
    const chatTitle = ctx.chat.title || 'منطقه';

    const { data: settings, error: settingsError } = await supabase
      .from('trigger_settings')
      .select('*')
      .eq('chat_id', chatId)
      .single();

    if (settingsError || !settings) {
      return ctx.reply('❌ تنظیمات تریگر یافت نشد. لطفاً ابتدا از /set_trigger استفاده کنید.');
    }

    const { trigger_name, delay_seconds, second_message, second_message_entities } = settings;

    try {
      const { data: existingRecord, error: checkError } = await supabase
        .from('user_quarantine')
        .select('user_id')
        .eq('user_id', userId)
        .single();

      if (existingRecord) {
        const { error: updateError } = await supabase
          .from('user_quarantine')
          .update({
            chat_id: chatId,
            is_quarantined: true,
            username: ctx.from.username,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            quarantine_start: new Date().toISOString(),
            quarantine_end: null
          })
          .eq('user_id', userId);

        if (updateError) {
          logger.error('Error updating quarantine status:', updateError);
          return ctx.reply('❌ خطا در به روز رسانی قرنطینه کاربر.');
        }
      } else {
        const { error: insertError } = await supabase
          .from('user_quarantine')
          .insert({
            user_id: userId,
            chat_id: chatId,
            is_quarantined: true,
            username: ctx.from.username,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            quarantine_start: new Date().toISOString(),
            quarantine_end: null
          });

        if (insertError) {
          logger.error('Error inserting quarantine status:', insertError);
          return ctx.reply('❌ خطا در ثبت قرنطینه کاربر.');
        }
      }

      userCache.delete(`quarantine_${userId}`);
      await kickUserFromAllGroupsExceptCurrent(userId, chatId);
      
      logger.info(`User ${userId} quarantined in group ${chatId}`);

    } catch (error) {
      logger.error('Error in quarantine process:', error);
      return ctx.reply('❌ خطایی در فرآیند قرنطینه رخ داد.');
    }

    const formattedDelay = formatDelayTime(delay_seconds);
    await ctx.replyWithHTML(
      `پلیر <b>${firstName}</b> وارد منطقه <b>${chatTitle}</b> شد.\n\n⏳┊مدت زمان سفر : ${formattedDelay}`,
      { reply_to_message_id: ctx.message.message_id }
    );

    setTimeout(async () => {
      try {
        await sendFormattedMessage(
          chatId,
          second_message,
          second_message_entities,
          ctx.message.message_id
        );
      } catch (error) {
        logger.error('Error sending delayed message:', error);
      }
    }, delay_seconds * 1000);

  } catch (error) {
    logger.error('Error in #ورود command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// 🔥 تشخیص #خروج در هر جای متن - غیرفعال کردن قرنطینه
bot.hears(/.*#خروج.*/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || 'پلیر';

    const { data: quarantine, error: checkError } = await supabase
      .from('user_quarantine')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!quarantine) {
      return ctx.reply('❌ شما در حال حاضر در قرنطینه نیستید.');
    }

    const { error: updateError } = await supabase
      .from('user_quarantine')
      .update({ 
        is_quarantined: false, 
        quarantine_end: new Date().toISOString() 
      })
      .eq('user_id', userId);

    if (updateError) {
      logger.error('Error updating quarantine status:', updateError);
      return ctx.reply('❌ خطا در به روز رسانی وضعیت قرنطینه.');
    }

    userCache.delete(`quarantine_${userId}`);
    
    await ctx.replyWithHTML(`🧭┊سفر به سلامت <b>${firstName}</b>`);
    
  } catch (error) {
    logger.error('Error in #خروج command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// 🔥 دستور برای نمایش لیست تریگرها
bot.command('list_triggers', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    
    const { data: triggers, error } = await supabase
      .from('trigger_settings')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (error || !triggers || triggers.length === 0) {
      return ctx.reply('❌ هیچ تریگری برای این گروه ثبت نشده است.');
    }

    let message = '📋 لیست تریگرهای این گروه:\n\n';
    
    triggers.forEach((trigger, index) => {
      const formattedDelay = formatDelayTime(trigger.delay_seconds);
      message += `${index + 1}. ${trigger.trigger_name}\n`;
      message += `   ⏰ تاخیر: ${formattedDelay}\n`;
      message += `   📅 تاریخ ایجاد: ${new Date(trigger.created_at).toLocaleDateString('fa-IR')}\n\n`;
    });

    await ctx.reply(message);
  } catch (error) {
    logger.error('Error in /list_triggers command:', error);
    ctx.reply('❌ خطایی در دریافت لیست تریگرها رخ داد.');
  }
});

// 🔥 دستور برای حذف تریگر
bot.command('delete_trigger', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const params = ctx.message.text.split(' ');
    
    if (params.length < 2) {
      return ctx.reply('⚠️ لطفاً نام تریگر را مشخص کنید. فرمت: /delete_trigger <نام تریگر>');
    }

    const triggerName = params.slice(1).join(' ');

    const { error } = await supabase
      .from('trigger_settings')
      .delete()
      .eq('chat_id', chatId)
      .eq('trigger_name', triggerName);

    if (error) {
      logger.error('Error deleting trigger:', error);
      return ctx.reply('❌ خطا در حذف تریگر. لطفاً نام تریگر را بررسی کنید.');
    }

    await ctx.reply(`✅ تریگر "${triggerName}" با موفقیت حذف شد.`);
  } catch (error) {
    logger.error('Error in /delete_trigger command:', error);
    ctx.reply('❌ خطایی در حذف تریگر رخ داد.');
  }
});

// 🔥 دستور برای بررسی وضعیت گروه
bot.command('group_status', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    
    const [dbStatus, botStatus] = await Promise.all([
      supabase
        .from('groups')
        .select('*')
        .eq('chat_id', chatId)
        .single(),
      
      bot.telegram.getChatMember(chatId, bot.botInfo.id)
    ]);

    let message = `📊 وضعیت گروه ${ctx.chat.title || 'بدون نام'}:\n\n`;
    
    if (!dbStatus.error && dbStatus.data) {
      message += `🗄️ وضعیت دیتابیس: ${dbStatus.data.is_bot_admin ? 'ادمین ✅' : 'غیر ادمین ❌'}\n`;
    } else {
      message += `🗄️ وضعیت دیتابیس: ثبت نشده ❌\n`;
    }
    
    message += `🤖 وضعیت واقعی: ${['administrator', 'creator'].includes(botStatus.status) ? 'ادمین ✅' : 'غیر ادمین ❌'}\n`;
    
    await ctx.reply(message);
  } catch (error) {
    logger.error('Error in group_status command:', error);
    ctx.reply('❌ خطا در بررسی وضعیت گروه');
  }
});

// 🔥 دستور جدید: ارتقای دسترسی ربات در گروه
bot.command('admin_g', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    
    if (chatType !== 'group' && chatType !== 'supergroup') {
      return ctx.reply('❌ این دستور فقط در گروه‌ها قابل استفاده است.');
    }

    // بررسی اینکه کاربر ادمین است
    try {
      const chatMember = await ctx.telegram.getChatMember(chatId, ctx.from.id);
      const isAdmin = ['administrator', 'creator'].includes(chatMember.status);
      
      if (!isAdmin) {
        return ctx.reply('❌ فقط ادمین‌های گروه می‌توانند از این دستور استفاده کنند.');
      }
    } catch (error) {
      logger.error('Error checking admin status:', error);
      return ctx.reply('❌ خطا در بررسی وضعیت ادمینی.');
    }

    // بررسی وضعیت فعلی ربات
    const botMember = await ctx.telegram.getChatMember(chatId, bot.botInfo.id);
    const isBotAdmin = botMember.status === 'administrator' && botMember.can_restrict_members;
    
    if (isBotAdmin) {
      return ctx.reply('✅ ربات در حال حاضر ادمین این گروه است و دسترسی کامل دارد.');
    }

    // راهنمایی برای ارتقای دسترسی ربات
    await ctx.replyWithHTML(`
🤖 <b>برای ارتقای دسترسی ربات لطفاً:</b>

1. به تنظیمات گروه بروید
2. روی لیست ادمین‌ها کلیک کنید
3. ربات را به عنوان ادمین انتخاب کنید
4. مطمئن شوید که تمام دسترسی‌ها به خصوص "حذف کاربران" فعال است

پس از انجام این مراحل، دوباره از دستور /admin_g استفاده کنید تا وضعیت بررسی شود.
    `);

    // ذخیره درخواست در دیتابیس
    await supabase
      .from('groups')
      .upsert({
        chat_id: chatId,
        title: ctx.chat.title || 'بدون نام',
        type: chatType,
        is_bot_admin: false,
        needs_admin: true,
        last_updated: new Date().toISOString()
      });

    logger.info(`Admin promotion requested for group ${chatId} by user ${ctx.from.id}`);

  } catch (error) {
    logger.error('Error in /admin_g command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// 🔥 middleware برای پردازش JSON
app.use(express.json());

// 🔥 مسیر سلامت سنجی (Health Check)
app.get('/health', async (req, res) => {
  try {
    // بررسی اتصال به دیتابیس
    const { error: dbError } = await supabase.from('groups').select('count').limit(1);
    
    // بررسی وضعیت ربات
    const botInfo = await bot.telegram.getMe();
    
    // بررسی وضعیت کش
    const cacheStats = userCache.stats();
    
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      database: dbError ? 'DISCONNECTED' : 'CONNECTED',
      bot: botInfo ? 'RUNNING' : 'ERROR',
      cache: {
        size: cacheStats.size,
        uptime: process.uptime()
      },
      memory: process.memoryUsage()
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      status: 'ERROR',
      error: error.message
    });
  }
});

// 🔥 مسیر webhook
app.post('/webhook', async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
  } catch (error) {
    logger.error('Error handling update:', error);
    res.status(200).send();
  }
});

// 🔥 راه‌اندازی سرور
app.listen(PORT, () => {
  logger.info(`🤖 ربات در پورت ${PORT} راه‌اندازی شد...`);
  logger.info(`🩺 سلامت سنجی در دسترس: http://localhost:${PORT}/health`);
});

// 🔥 توابع تست واحد (برای استفاده در فایل‌های تست جداگانه)
module.exports = {
  formatDelayTime,
  checkUserQuarantine,
  userCache,
  logger
};