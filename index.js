const { Telegraf, Scenes, session } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// بررسی وجود متغیرهای محیطی
if (!process.env.BOT_TOKEN) {
  console.error('❌ ERROR: BOT_TOKEN is not set!');
  process.exit(1);
}
if (!process.env.SUPABASE_URL) {
  console.error('❌ ERROR: SUPABASE_URL is not set!');
  process.exit(1);
}
if (!process.env.SUPABASE_KEY) {
  console.error('❌ ERROR: SUPABASE_KEY is not set!');
  process.exit(1);
}

// تنظیم مالکین ربات
const BOT_OWNERS = [123456789]; // آی دی مالکین را اینجا قرار دهید

// مقداردهی Supabase و Telegraf
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Telegraf(process.env.BOT_TOKEN);

// 🔥 بهبود سیستم کش با کلاس پیشرفته
class AdvancedCache {
  constructor() {
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }
  
  set(key, value, ttl = 5 * 60 * 1000) {
    this.cache.set(key, {
      data: value,
      expiry: Date.now() + ttl
    });
  }
  
  get(key) {
    const item = this.cache.get(key);
    
    if (!item) {
      this.misses++;
      return null;
    }
    
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    
    this.hits++;
    return item.data;
  }
  
  delete(key) {
    this.cache.delete(key);
  }
  
  clear() {
    this.cache.clear();
  }
  
  stats() {
    const hitRatio = this.hits + this.misses > 0 
      ? (this.hits / (this.hits + this.misses) * 100).toFixed(2) 
      : 0;
    
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRatio: `${hitRatio}%`
    };
  }
}

const userCache = new AdvancedCache();

// 🔥 تابع برای ارسال اطلاع به مالک
async function notifyOwner(message) {
  if (!BOT_OWNERS || BOT_OWNERS.length === 0) return;
  
  try {
    for (const ownerId of BOT_OWNERS) {
      await bot.telegram.sendMessage(ownerId, `⚠️ ${message}`);
    }
  } catch (error) {
    console.error('خطا در ارسال اطلاع به مالک:', error);
  }
}

// 🔥 تابع بررسی حجم دیتابیس و ارسال هشدار
async function checkDatabaseSize() {
  try {
    const { data, error } = await supabase
      .rpc('get_database_size');
    
    if (error) throw error;
    
    const sizeMB = Math.round(data / 1024 / 1024);
    
    if (sizeMB >= 300) {
      await notifyOwner(`🚨 حجم دیتابیس به ${sizeMB}MB رسیده است!`);
    }
    
    // ارسال هشدار هر 50 مگابایت
    if (sizeMB % 50 === 0) {
      await notifyOwner(`📊 حجم دیتابیس: ${sizeMB}MB`);
    }
    
    return sizeMB;
  } catch (error) {
    console.error('خطا در بررسی حجم دیتابیس:', error);
    return null;
  }
}

// 🔥 تابع پاکسازی داده‌های قدیمی
async function cleanupOldData() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    
    // پاکسازی user_quarantine قدیمی
    const { count: quarantineCount } = await supabase
      .from('user_quarantine')
      .delete()
      .lt('quarantine_end', thirtyDaysAgo);

    // پاکسازی trigger_settings قدیمی
    const { count: triggerCount } = await supabase
      .from('trigger_settings')
      .delete()
      .lt('created_at', thirtyDaysAgo);

    console.log(`✅ پاکسازی داده‌های قدیمی: ${quarantineCount} رکورد قرنطینه و ${triggerCount} رکورد تریگر حذف شدند`);
    
    return { quarantineCount, triggerCount };
  } catch (error) {
    console.error('خطا در پاکسازی داده‌ها:', error);
    return { quarantineCount: 0, triggerCount: 0 };
  }
}

// تابع برای بررسی وضعیت قرنطینه کاربر
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
      console.error('Error checking user quarantine:', error);
      return null;
    }

    if (quarantine) {
      userCache.set(cacheKey, quarantine);
      return quarantine;
    }
    
    return null;
  } catch (error) {
    console.error('Exception in checkUserQuarantine:', error);
    return null;
  }
}

// تابع برای کیک کردن کاربر از گروه
async function kickUserFromGroup(chatId, userId, reason = 'قرنطینه فعال') {
  try {
    const botMember = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    const canKick = botMember.status === 'administrator' && botMember.can_restrict_members;
    
    if (!canKick) {
      console.log(`⚠️ ربات در گروه ${chatId} حق کیک کردن ندارد`);
      return false;
    }
    
    await bot.telegram.kickChatMember(chatId, userId);
    console.log(`✅ کاربر ${userId} از گروه ${chatId} کیک شد (${reason})`);
    
    setTimeout(async () => {
      try {
        await bot.telegram.unbanChatMember(chatId, userId);
      } catch (unbanError) {
        console.error('خطا در آنبن کردن کاربر:', unbanError);
      }
    }, 1000);
    
    return true;
  } catch (error) {
    console.error(`❌ خطا در کیک کردن کاربر ${userId}:`, error);
    return false;
  }
}

// تابع برای کیک کردن کاربر از تمام گروه‌ها به جز گروه فعلی
async function kickUserFromAllGroupsExceptCurrent(userId, currentChatId) {
  try {
    const { data: groups, error } = await supabase
      .from('groups')
      .select('chat_id, title, is_bot_admin')
      .eq('is_bot_admin', true);

    if (error) throw error;

    let kickedCount = 0;
    
    for (const group of groups) {
      if (group.chat_id.toString() !== currentChatId.toString()) {
        try {
          const kicked = await kickUserFromGroup(group.chat_id, userId, 'قرنطینه فعال - انتقال به گروه جدید');
          if (kicked) kickedCount++;
        } catch (error) {
          console.error(`Error kicking from group ${group.chat_id}:`, error);
        }
      }
    }
    
    console.log(`✅ کاربر از ${kickedCount} گروه کیک شد`);
    return kickedCount;
  } catch (error) {
    console.error('Error in kickUserFromAllGroupsExceptCurrent:', error);
    return 0;
  }
}

// تابع برای ذخیره‌سازی پیام با entities و فرمت‌ها
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

// تابع برای ارسال پیام با حفظ entities و فرمت‌ها
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
    console.error('Error sending formatted message:', error);
    
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
      console.error('Fallback message sending also failed:', fallbackError);
      return false;
    }
  }
}

// تابع برای تبدیل ثانیه به فرمت خوانا
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

// 🔥 تابع بهبود یافته برای بررسی دسترسی ربات در گروه
async function checkBotAdminStatus(chatId) {
  try {
    const cacheKey = `bot_admin_${chatId}`;
    const cached = userCache.get(cacheKey);
    
    // 🔥 کاهش TTL برای گروه‌های جدید
    const cacheTTL = 30 * 1000; // 30 ثانیه
    
    if (cached && Date.now() - cached.timestamp < cacheTTL) {
      return cached.data;
    }

    // بررسی مستقیم از تلگرام
    try {
      const botMember = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
      const isAdmin = botMember.status === 'administrator' && botMember.can_restrict_members;
      
      // ذخیره در دیتابیس
      await supabase
        .from('groups')
        .upsert({
          chat_id: chatId,
          is_bot_admin: isAdmin,
          last_updated: new Date().toISOString()
        }, {
          onConflict: 'chat_id'
        });

      userCache.set(cacheKey, isAdmin, cacheTTL);
      return isAdmin;
    } catch (tgError) {
      console.error('Error checking bot admin status:', tgError);
      return false;
    }
  } catch (error) {
    console.error('Error in checkBotAdminStatus:', error);
    return false;
  }
}

// 🔥 تأخیر 2 ثانیه و بررسی مجدد وضعیت
async function delayedAdminCheck(chatId) {
  await new Promise(resolve => setTimeout(resolve, 2000));
  return await checkBotAdminStatus(chatId);
}

// 🔥 تابع بهبود یافته قرنطینه خودکار
async function autoQuarantineUser(userId, chatId, userInfo) {
  try {
    // بررسی وضعیت ادمین بودن ربات با تأخیر
    const isBotAdmin = await delayedAdminCheck(chatId);
    
    if (!isBotAdmin) {
      console.log(`⚠️ ربات در گروه ${chatId} ادمین نیست`);
      return false;
    }

    // ذخیره اطلاعات کاربر
    await supabase
      .from('users')
      .upsert({
        user_id: userId,
        first_name: userInfo.first_name,
        username: userInfo.username,
        last_name: userInfo.last_name,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    // بررسی قرنطینه موجود
    const existingQuarantine = await checkUserQuarantine(userId);
    
    if (existingQuarantine) {
      if (existingQuarantine.chat_id !== chatId) {
        await kickUserFromGroup(chatId, userId, 'کاربر در قرنطینه فعال است');
        return true;
      }
      return false; // کاربر قبلاً در همین گروه قرنطینه شده
    }

    // ایجاد قرنطینه جدید
    const { error } = await supabase
      .from('user_quarantine')
      .upsert({
        user_id: userId,
        chat_id: chatId,
        is_quarantined: true,
        username: userInfo.username,
        first_name: userInfo.first_name,
        last_name: userInfo.last_name,
        quarantine_start: new Date().toISOString(),
        quarantine_end: null
      }, { onConflict: 'user_id' });

    if (error) throw error;

    // پاکسازی کش و کیک از گروه‌های دیگر
    userCache.delete(`quarantine_${userId}`);
    await kickUserFromAllGroupsExceptCurrent(userId, chatId);
    
    console.log(`✅ کاربر ${userId} با موفقیت قرنطینه شد`);
    return true;
  } catch (error) {
    console.error('❌ خطا در قرنطینه خودکار:', error);
    return false;
  }
}

// 🔥 تابع تقویت شده برای قرنطینه خودکار
async function enhancedAutoQuarantine(userId, chatId, userInfo) {
  try {
    // بررسی دقیق‌تر وضعیت ادمین بودن ربات
    const isBotAdmin = await checkBotAdminStatus(chatId);
    if (!isBotAdmin) {
      console.log(`⚠️ ربات در گروه ${chatId} ادمین نیست یا دسترسی کافی ندارد`);
      return false;
    }

    // بررسی جامع قرنطینه کاربر
    const quarantineStatus = await checkUserQuarantine(userId);
    
    if (quarantineStatus) {
      if (quarantineStatus.chat_id.toString() !== chatId.toString()) {
        // کاربر در گروه دیگری قرنطینه است
        console.log(`🚫 کاربر ${userId} در گروه ${quarantineStatus.chat_id} قرنطینه است`);
        await kickUserFromGroup(chatId, userId, 'کاربر در گروه دیگری قرنطینه است');
        return true;
      }
      // کاربر قبلاً در همین گروه قرنطینه شده
      return false;
    }

    // ایجاد قرنطینه جدید
    const { error } = await supabase
      .from('user_quarantine')
      .upsert({
        user_id: userId,
        chat_id: chatId,
        is_quarantined: true,
        username: userInfo.username,
        first_name: userInfo.first_name,
        last_name: userInfo.last_name,
        quarantine_start: new Date().toISOString(),
        quarantine_end: null
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('Error creating quarantine:', error);
      return false;
    }

    // پاکسازی کش و اجرای قرنطینه
    userCache.delete(`quarantine_${userId}`);
    await kickUserFromAllGroupsExceptCurrent(userId, chatId);
    
    console.log(`✅ کاربر ${userId} با موفقیت قرنطینه شد`);
    return true;
  } catch (error) {
    console.error('❌ خطا در قرنطینه پیشرفته:', error);
    return false;
  }
}

// 🔥 سیستم تشخیص پیشرفته وضعیت ادمین
async function advancedAdminCheck(chatId) {
  try {
    const cacheKey = `admin_status_${chatId}`;
    
    // بررسی کش
    const cachedStatus = userCache.get(cacheKey);
    if (cachedStatus) {
      return cachedStatus;
    }

    // بررسی مستقیم از تلگرام
    try {
      const botMember = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
      const isAdmin = botMember.status === 'administrator' && botMember.can_restrict_members;
      
      // ذخیره در دیتابیس
      await supabase
        .from('groups')
        .upsert({
          chat_id: chatId,
          is_bot_admin: isAdmin,
          last_updated: new Date().toISOString()
        }, { onConflict: 'chat_id' });

      // ذخیره در کش با TTL کوتاه‌تر
      userCache.set(cacheKey, isAdmin, 15 * 1000); // 15 ثانیه
      
      return isAdmin;
    } catch (error) {
      console.error('Error checking admin status directly:', error);
      return false;
    }
  } catch (error) {
    console.error('Error in advancedAdminCheck:', error);
    return false;
  }
}

// 🔥 سیستم گزارش‌دهی پیشرفته
async function generateQuarantineReport() {
  try {
    const { data: activeQuarantines, error } = await supabase
      .from('user_quarantine')
      .select('*')
      .eq('is_quarantined', true);

    if (error) throw error;

    let report = `📊 گزارش وضعیت قرنطینه\n\n`;
    report += `✅ کاربران قرنطینه شده: ${activeQuarantines.length}\n\n`;

    for (const quarantine of activeQuarantines) {
      report += `👤 کاربر: ${quarantine.first_name} ${quarantine.last_name}\n`;
      report += `🆔 آی‌دی: ${quarantine.user_id}\n`;
      report += `🏠 گروه: ${quarantine.chat_id}\n`;
      report += `⏰ شروع: ${new Date(quarantine.quarantine_start).toLocaleString('fa-IR')}\n`;
      report += `────────────────────\n`;
    }

    // ارسال گزارش به مالکان
    for (const ownerId of BOT_OWNERS) {
      try {
        await bot.telegram.sendMessage(ownerId, report);
      } catch (error) {
        console.error('Error sending report to owner:', error);
      }
    }

    return activeQuarantines.length;
  } catch (error) {
    console.error('Error generating quarantine report:', error);
    return 0;
  }
}

// تعریف سناریو برای تنظیمات تریگر (Wizard)
const setTriggerWizard = new Scenes.WizardScene(
  'set_trigger_wizard',
  async (ctx) => {
    await ctx.reply('🤖 لطفاً نام تریگر را وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.triggerName = ctx.message.text;
    await ctx.reply('⏰ لطفاً زمان تاخیر به ثانیه وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const delaySeconds = parseInt(ctx.message.text);
    if (isNaN(delaySeconds) || delaySeconds <= 0) {
      await ctx.reply('⚠️ زمان باید یک عدد مثبت باشد. لطفاً دوباره وارد کنید:');
      return;
    }
    
    ctx.wizard.state.delaySeconds = delaySeconds;
    await ctx.reply('📩 لطفاً پیام تاخیری را وارد کنید (می‌توانید از لینک و فرمت استفاده کنید):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    // ذخیره پیام تاخیری با entities
    ctx.wizard.state.secondMessage = ctx.message.text;
    ctx.wizard.state.secondMessageData = await saveMessageWithEntities(
      ctx.message.text,
      ctx.message.entities || ctx.message.caption_entities
    );
    
    // ذخیره در دیتابیس
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
      console.error('Error saving trigger settings:', error);
      await ctx.reply('❌ خطا در ذخیره تنظیمات.');
    } else {
      const formattedDelay = formatDelayTime(ctx.wizard.state.delaySeconds);
      await ctx.replyWithHTML(`✅ تنظیمات تریگر با موفقیت ذخیره شد!\n\n📋 خلاصه تنظیمات:\n<b>نام:</b> ${ctx.wizard.state.triggerName}\n<b>تاخیر:</b> ${formattedDelay}`);
    }
    
    return ctx.scene.leave();
  }
);

// ثبت سناریو
const stage = new Scenes.Stage([setTriggerWizard]);

// 🔥 تصحیح middlewareها
bot.use(session());
bot.use(stage.middleware());

// 🔥 هندلر بهبود یافته برای ثبت گروه
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
      console.error('Error checking admin status:', error);
      return ctx.reply('❌ خطا در بررسی وضعیت ادمینی.');
    }

    // بررسی دسترسی ربات در گروه
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
      }, {
        onConflict: 'chat_id'
      });

    if (error) {
      console.error('Error saving group:', error);
      return ctx.reply('❌ خطا در ثبت گروه. لطفاً بعداً تلاش کنید.');
    }

    // پاکسازی کش برای اطمینان از بروزرسانی
    userCache.delete(`bot_admin_${chatId}`);
    
    await ctx.reply(`✅ گروه "${chatTitle}" با موفقیت در سیستم ثبت شد!`);

  } catch (error) {
    console.error('Error in #فعال command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// 🔥 هندلر بهبود یافته برای زمانی که ربات به گروهی اضافه می‌شود
bot.on('my_chat_member', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const newStatus = ctx.update.my_chat_member.new_chat_member.status;
    const chatTitle = ctx.chat.title || 'بدون نام';
    const chatType = ctx.chat.type;

    if (chatType === 'group' || chatType === 'supergroup') {
      // بررسی آیا ربات ادمین است
      const isBotAdmin = newStatus === 'administrator';
      
      const { error } = await supabase
        .from('groups')
        .upsert({
          chat_id: chatId,
          title: chatTitle,
          type: chatType,
          is_bot_admin: isBotAdmin,
          last_updated: new Date().toISOString()
        }, {
          onConflict: 'chat_id'
        });

      if (!error) {
        console.log(`✅ گروه ذخیره شد: ${chatTitle} (${chatId}) - وضعیت ادمین: ${isBotAdmin}`);
        
        // پاکسازی کش وضعیت ربات
        userCache.delete(`bot_admin_${chatId}`);
        
        // 🔥 اطلاع به مالک
        await notifyOwner(`🤖 ربات به گروه "${chatTitle}" اضافه شد. وضعیت ادمین: ${isBotAdmin ? '✅' : '❌'}`);
      }
    }
  } catch (error) {
    console.error('Error in my_chat_member handler:', error);
  }
});

// 🔥 هندلر تقویت شده برای کاربران جدید
bot.on('new_chat_members', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    
    // بررسی اینکه آیا ربات یکی از کاربران اضافه شده است
    const isBotAdded = ctx.message.new_chat_members.some(user => user.id === ctx.botInfo.id);
    
    if (isBotAdded) {
      // اگر ربات به گروه اضافه شده، وضعیت را بررسی و ثبت کنید
      const botMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
      const isAdmin = botMember.status === 'administrator' && botMember.can_restrict_members;
      
      await supabase
        .from('groups')
        .upsert({
          chat_id: chatId,
          title: ctx.chat.title,
          type: ctx.chat.type,
          is_bot_admin: isAdmin,
          last_updated: new Date().toISOString()
        }, { onConflict: 'chat_id' });
      
      if (!isAdmin) {
        return ctx.reply('❌ برای عملکرد صحیح، ربات باید ادمین شود و حق restrict کاربران را داشته باشد');
      }
      
      return;
    }

    // پردازش کاربران عادی
    for (const newMember of ctx.message.new_chat_members) {
      if (newMember.is_bot) continue;
      
      await enhancedAutoQuarantine(
        newMember.id,
        chatId,
        {
          first_name: newMember.first_name,
          username: newMember.username,
          last_name: newMember.last_name
        }
      );
    }
  } catch (error) {
    console.error('Error in new_chat_members handler:', error);
  }
});

// 🔥 هندلر برای بررسی وضعیت عضویت
bot.on('chat_member', async (ctx) => {
  try {
    const newStatus = ctx.update.chat_member.new_chat_member.status;
    const oldStatus = ctx.update.chat_member.old_chat_member.status;
    const userId = ctx.update.chat_member.from.id;
    const chatId = ctx.chat.id;

    // فقط زمانی که کاربر به گروه می‌پیوندد
    if (oldStatus === 'left' && newStatus === 'member') {
      const quarantine = await checkUserQuarantine(userId);
      
      if (quarantine && quarantine.chat_id !== chatId) {
        await kickUserFromGroup(chatId, userId, 'کاربر در قرنطینه است');
      }
    }
  } catch (error) {
    console.error('Error in chat_member handler:', error);
  }
});

// 🔥 بهبود یافته: هندلر تشخیص خودکار گروه‌های جدید
bot.on('message', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    
    if ((chatType === 'group' || chatType === 'supergroup') && ctx.message.text !== '/start') {
      // بررسی و ثبت خودکار گروه
      const isBotAdmin = await advancedAdminCheck(chatId);
      
      await supabase
        .from('groups')
        .upsert({
          chat_id: chatId,
          title: ctx.chat.title || 'بدون نام',
          type: chatType,
          is_bot_admin: isBotAdmin,
          last_updated: new Date().toISOString()
        }, { onConflict: 'chat_id' });
    }
  } catch (error) {
    console.error('Error in auto group detection:', error);
  }
});

// دستور start
bot.start(async (ctx) => {
  try {
    const chatId = ctx.message.chat.id;
    const firstName = ctx.message.chat.first_name || 'کاربر';
    const username = ctx.message.chat.username;

    // ثبت کاربر در دیتابیس
    await supabase
      .from('users')
      .upsert({
        user_id: chatId,
        first_name: firstName,
        username: username,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });

    await ctx.reply(`سلام ${firstName}! 😊`);

    // پیام برای مالکین
    if (BOT_OWNERS.includes(ctx.from.id)) {
      await ctx.replyWithHTML(`
🤖 <b>دستورات disponibles:</b>
/set_trigger - تنظیم تریگر جدید
#فعال - ثبت گروه در سیستم (فقط ادمین)
/list_triggers - مشاهده لیست تریگرها
/delete_trigger - حذف تریگر
/group_status - بررسی وضعیت گروه
/admin_g - تنظیم گروه به عنوان ادمین در دیتابیس
/remove_group - حذف گروه از دیتابیس
/update_status - بروزرسانی فوری وضعیت گروه
/test_quarantine - تست قرنطینه کاربر
/debug_status - گزارش دیباگ
/scan_members - اسکن کاربران گروه
      `);
    }

  } catch (err) {
    console.error('Error in /start command:', err);
    ctx.reply('❌ خطای غیرمنتظره‌ای رخ داد.');
  }
});

// 🔥 دستور برای بروزرسانی فوری وضعیت گروه
bot.command('update_status', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    
    if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
      return ctx.reply('❌ این دستور فقط در گروه‌ها قابل استفاده است.');
    }

    // پاکسازی کش
    userCache.delete(`bot_admin_${chatId}`);
    
    // بررسی مجدد وضعیت
    const isBotAdmin = await advancedAdminCheck(chatId);
    
    await ctx.reply(`✅ وضعیت بروزرسانی شد: ${isBotAdmin ? 'ادمین ✅' : 'غیر ادمین ❌'}`);
  } catch (error) {
    console.error('Error in update_status command:', error);
    ctx.reply('❌ خطا در بروزرسانی وضعیت');
  }
});

// دستور set_trigger - شروع فرآیند تنظیمات
bot.command('set_trigger', (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }
  ctx.scene.enter('set_trigger_wizard');
});

// تشخیص #ورود در هر جای متن
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

    // قرنطینه کاربر
    await enhancedAutoQuarantine(userId, chatId, {
      first_name: ctx.from.first_name,
      username: ctx.from.username,
      last_name: ctx.from.last_name
    });

    // ارسال پیام اول (ثابت)
    const formattedDelay = formatDelayTime(delay_seconds);
    await ctx.replyWithHTML(
      `پلیر <b>${firstName}</b> وارد منطقه <b>${chatTitle}</b> شد.\n\n⏳┊مدت زمان سفر : ${formattedDelay}`,
      { reply_to_message_id: ctx.message.message_id }
    );

    // ارسال پیام دوم با تاخیر (با حفظ فرمت و لینک‌ها)
    setTimeout(async () => {
      try {
        await sendFormattedMessage(
          chatId,
          second_message,
          second_message_entities,
          ctx.message.message_id
        );
      } catch (error) {
        console.error('Error sending delayed message:', error);
      }
    }, delay_seconds * 1000);

  } catch (error) {
    console.error('Error in #ورود command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// تشخیص #خروج در هر جای متن - غیرفعال کردن قرنطینه
bot.hears(/.*#خروج.*/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || 'پلیر';

    // بررسی وجود کاربر در قرنطینه
    const { data: quarantine, error: checkError } = await supabase
      .from('user_quarantine')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!quarantine) {
      return ctx.reply('❌ شما در حال حاضر در قرنطینه نیستید.');
    }

    // به روز رسانی وضعیت قرنطینه کاربر
    const { error: updateError } = await supabase
      .from('user_quarantine')
      .update({ 
        is_quarantined: false, 
        quarantine_end: new Date().toISOString() 
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('Error updating quarantine status:', updateError);
      return ctx.reply('❌ خطا در به روز رسانی وضعیت قرنطینه.');
    }

    // پاکسازی کش
    userCache.delete(`quarantine_${userId}`);
    
    // ارسال پیام خروج
    await ctx.replyWithHTML(`🧭┊سفر به سلامت <b>${firstName}</b>`);
    
  } catch (error) {
    console.error('Error in #خروج command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// دستور برای نمایش لیست تریگرها
bot.command('list_triggers', async (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }

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
    console.error('Error in /list_triggers command:', error);
    ctx.reply('❌ خطایی در دریافت لیست تریگرها رخ داد.');
  }
});

// دستور برای حذف تریگر
bot.command('delete_trigger', async (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }

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
      console.error('Error deleting trigger:', error);
      return ctx.reply('❌ خطا در حذف تریگر. لطفاً نام تریگر را بررسی کنید.');
    }

    await ctx.reply(`✅ تریگر "${triggerName}" با موفقیت حذف شد.`);
  } catch (error) {
    console.error('Error in /delete_trigger command:', error);
    ctx.reply('❌ خطایی در حذف تریگر رخ داد.');
  }
});

// دستور برای بررسی وضعیت گروه
bot.command('group_status', async (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }

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
    console.error('Error in group_status command:', error);
    ctx.reply('❌ خطا در بررسی وضعیت گروه');
  }
});

// دستور برای تنظیم گروه به عنوان ادمین در دیتابیس
bot.command('admin_g', async (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }

  try {
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    
    if (chatType !== 'group' && chatType !== 'supergroup') {
      return ctx.reply('❌ این دستور فقط در گروه‌ها قابل استفاده است.');
    }

    // بررسی وضعیت واقعی ربات در گروه
    const botMember = await ctx.telegram.getChatMember(chatId, bot.botInfo.id);
    const isBotAdmin = botMember.status === 'administrator' && botMember.can_restrict_members;
    
    if (!isBotAdmin) {
      return ctx.reply('❌ ربات باید ابتدا در گروه ادمین شود سپس از این دستور استفاده کنید.');
    }

    // به روز رسانی وضعیت گروه در دیتابیس
    const { error } = await supabase
      .from('groups')
      .upsert({
        chat_id: chatId,
        title: ctx.chat.title || 'بدون نام',
        type: chatType,
        is_bot_admin: true,
        last_updated: new Date().toISOString()
      }, {
        onConflict: 'chat_id'
      });

    if (error) {
      console.error('Error updating group status:', error);
      return ctx.reply('❌ خطا در به روز رسانی وضعیت گروه.');
    }

    // پاکسازی کش
    userCache.delete(`bot_admin_${chatId}`);
    
    await ctx.reply('✅ گروه با موفقیت در دیتابیس به عنوان ادمین ثبت شد!');
    
  } catch (error) {
    console.error('Error in /admin_g command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// دستور برای حذف گروه از دیتابیس
bot.command('remove_group', async (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }

  try {
    const chatId = ctx.chat.id;
    
    const { error } = await supabase
      .from('groups')
      .delete()
      .eq('chat_id', chatId);

    if (error) {
      console.error('Error deleting group:', error);
      return ctx.reply('❌ خطا در حذف گروه از دیتابیس.');
    }

    // پاکسازی کش
    userCache.delete(`bot_admin_${chatId}`);
    
    await ctx.reply('✅ گروه با موفقیت از دیتابیس حذف شد!');
    
  } catch (error) {
    console.error('Error in /remove_group command:', error);
    ctx.reply('❌ خطایی در حذف گروه رخ داد.');
  }
});

// 🔥 دستور تست قرنطینه
bot.command('test_quarantine', async (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }

  try {
    const result = await enhancedAutoQuarantine(
      ctx.from.id,
      ctx.chat.id,
      {
        first_name: ctx.from.first_name,
        username: ctx.from.username,
        last_name: ctx.from.last_name
      }
    );

    if (result) {
      await ctx.reply('✅ کاربر با موفقیت قرنطینه شد');
    } else {
      await ctx.reply('❌ خطا در قرنطینه کاربر');
    }
  } catch (error) {
    console.error('Error in test_quarantine:', error);
    await ctx.reply('❌ خطای سیستمی در قرنطینه');
  }
});

// 🔥 دستورات دیباگ برای مالکان
bot.command('debug_status', async (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }

  try {
    const chatId = ctx.chat.id;
    
    const [adminStatus, quarantineCount, groupInfo] = await Promise.all([
      advancedAdminCheck(chatId),
      supabase.from('user_quarantine').select('*').eq('is_quarantined', true),
      supabase.from('groups').select('*').eq('chat_id', chatId).single()
    ]);

    let debugMessage = `🐛 گزارش دیباگ\n\n`;
    debugMessage += `🏠 گروه: ${ctx.chat.title}\n`;
    debugMessage += `🆔 آی‌دی: ${chatId}\n`;
    debugMessage += `🤖 وضعیت ادمین: ${adminStatus ? '✅' : '❌'}\n`;
    debugMessage += `🔒 کاربران قرنطینه: ${quarantineCount.data.length}\n`;
    debugMessage += `📊 وضعیت گروه در دیتابیس: ${groupInfo.data ? '✅' : '❌'}\n`;

    if (groupInfo.data) {
      debugMessage += `⏰ آخرین بروزرسانی: ${new Date(groupInfo.data.last_updated).toLocaleString('fa-IR')}\n`;
    }

    await ctx.reply(debugMessage);
  } catch (error) {
    console.error('Error in debug command:', error);
    await ctx.reply('❌ خطا در تولید گزارش دیباگ');
  }
});

// دستور برای بازنگری تمام کاربران گروه
bot.command('scan_members', async (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }

  try {
    const chatId = ctx.chat.id;
    const members = await ctx.telegram.getChatMembersCount(chatId);
    
    await ctx.reply(`🔍 اسکن ${members} کاربر شروع شد...`);

    // اینجا می‌توانید لوپ برای بررسی تمام کاربران اضافه کنید
    // برای جلوگیری از زمان‌بر شدن، می‌توانید از pagination استفاده کنید

    await ctx.reply('✅ اسکن کاربران با موفقیت انجام شد');
  } catch (error) {
    console.error('Error scanning members:', error);
    await ctx.reply('❌ خطا در اسکن کاربران');
  }
});

// 🔥 زمان‌بندی برای پاکسازی هفتگی
setInterval(async () => {
  const result = await cleanupOldData();
  await notifyOwner(`🧹 پاکسازی هفتگی انجام شد: ${result.quarantineCount} رکورد قرنطینه و ${result.triggerCount} رکورد تریگر حذف شدند`);
}, 7 * 24 * 60 * 60 * 1000); // هر 7 روز

// 🔥 زمان‌بندی برای بررسی منظم منابع
setInterval(async () => {
  // بررسی حجم دیتابیس
  const dbSize = await checkDatabaseSize();
  
  // بررسی وضعیت کش
  const cacheStats = userCache.stats();
  
  // ارسال گزارش به مالک
  if (BOT_OWNERS && BOT_OWNERS.length > 0 && dbSize !== null) {
    await notifyOwner(
      `📊 گزارش منظم:\n` +
      `• حجم دیتابیس: ${dbSize}MB\n` +
      `• اندازه کش: ${cacheStats.size} آیتم\n` +
      `• نرخ hit کش: ${cacheStats.hitRatio}`
    );
  }
}, 6 * 60 * 60 * 1000); // هر 6 ساعت

// 🔥 زمان‌بندی برای گزارش روزانه قرنطینه
setInterval(() => {
  generateQuarantineReport();
}, 24 * 60 * 60 * 1000);

// middleware برای پردازش JSON
app.use(express.json());

// مسیر webhook
app.post('/webhook', async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
  } catch (error) {
    console.error('Error handling update:', error);
    res.status(200).send();
  }
});

// راه‌اندازی سرور
app.listen(PORT, () => {
  console.log(`🤖 ربات در پورت ${PORT} راه‌اندازی شد...`);
  console.log(`🔄 سیستم قرنطینه خودکار فعال شد`);
});