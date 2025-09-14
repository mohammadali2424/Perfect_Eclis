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

// متغیرهای جدید
let botOwnerId = parseInt(process.env.OWNER_ID) || null;
const ALERT_THRESHOLD = parseInt(process.env.ALERT_THRESHOLD) || 300; // مگابایت

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
  if (!botOwnerId) return;
  
  try {
    await bot.telegram.sendMessage(botOwnerId, `⚠️ ${message}`);
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
    
    if (sizeMB >= ALERT_THRESHOLD) {
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

// 🔥 تابع فشرده‌سازی داده‌های ذخیره‌شده
function compressData(data) {
  if (!data) return data;
  
  // برای داده‌های بزرگ، فشرده‌سازی انجام می‌شود
  if (JSON.stringify(data).length > 1000) {
    return {
      compressed: true,
      data: JSON.stringify(data)
    };
  }
  
  return data;
}

// 🔥 تابع بازکردن داده‌های فشرده
function decompressData(data) {
  if (data && data.compressed) {
    return JSON.parse(data.data);
  }
  
  return data;
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
    const { data: groups, error: groupsError } = await supabase
      .from('groups')
      .select('chat_id, title')
      .eq('is_bot_admin', true);

    if (groupsError) {
      console.error('Error fetching groups:', groupsError);
      return 0;
    }

    if (!groups || groups.length === 0) {
      return 0;
    }
    
    let kickedCount = 0;
    
    for (const group of groups) {
      if (group.chat_id !== currentChatId) {
        const kicked = await kickUserFromGroup(group.chat_id, userId, 'قرنطینه فعال - انتقال به گروه جدید');
        if (kicked) kickedCount++;
      }
    }
    
    console.log(`✅ کاربر ${userId} از ${kickedCount} گروه کیک شد`);
    return kickedCount;
  } catch (error) {
    console.error('Error kicking user from all groups:', error);
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

// تابع برای بررسی دسترسی ربات در گروه
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
      console.error('Error checking bot admin status:', tgError);
      return false;
    }
  } catch (error) {
    console.error('Error in checkBotAdminStatus:', error);
    return false;
  }
}

// تعریف سناریو برای تنظیمات تریگر (Wizard)
const setTriggerWizard = new Scenes.WizardScene(
  'set_trigger_wizard',
  async (ctx) => {
    try {
      await ctx.reply('🤖 لطفاً نام تریگر را وارد کنید:');
      return ctx.wizard.next();
    } catch (error) {
      console.error('Error in setTriggerWizard step 1:', error);
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
      console.error('Error in setTriggerWizard step 2:', error);
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
      console.error('Error in setTriggerWizard step 3:', error);
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
        console.error('Error saving trigger settings:', error);
        await ctx.reply('❌ خطا در ذخیره تنظیمات.');
      } else {
        const formattedDelay = formatDelayTime(ctx.wizard.state.delaySeconds);
        await ctx.replyWithHTML(`✅ تنظیمات تریگر با موفقیت ذخیره شد!\n\n📋 خلاصه تنظیمات:\n<b>نام:</b> ${ctx.wizard.state.triggerName}\n<b>تاخیر:</b> ${formattedDelay}`);
      }
    } catch (error) {
      console.error('Error in setTriggerWizard step 4:', error);
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
        return ctx.reply('❌ فقط ادمین‌های گروه می‌توانند از این دستور استف��ده کنند.');
      }
    } catch (error) {
      console.error('Error checking admin status:', error);
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
      console.error('Error saving group:', error);
      return ctx.reply('❌ خطا در ثبت گروه. لطفاً بعداً تلاش کنید.');
    }

    await ctx.reply(`✅ گروه "${chatTitle}" با موفقیت در سیستم ثبت شد!`);
    console.log(`Group registered: ${chatTitle} (${chatId}) by user ${userId}`);

  } catch (error) {
    console.error('Error in #فعال command:', error);
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
        console.error('Error saving group status:', error);
      } else {
        console.log(`Group status updated: ${chatTitle} (${chatId}) - Admin: ${isBotAdmin}`);
        userCache.delete(`bot_admin_${chatId}`);
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
    const chatTitle = ctx.chat.title || 'بدون نام';
    
    for (const newMember of ctx.message.new_chat_members) {
      const userId = newMember.id;
      
      if (newMember.is_bot) continue;

      const isBotAdmin = await checkBotAdminStatus(chatId);
      if (!isBotAdmin) {
        console.log(`⚠️ ربات در گروه ${chatId} ادمین نیست، نمی‌تواند کاربر را قرنطینه کند`);
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
      
      console.log(`✅ کاربر ${userId} در گروه جدید ${chatTitle} (${chatId}) قرنطینه شد`);
    }
  } catch (error) {
    console.error('Error in new_chat_members handler:', error);
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
    console.error('Error in chat_member handler:', error);
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
        console.error('Supabase insert error:', error);
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
/admin_g - تنظیم گروه به عنوان ادمین در دیتابیس
/remove_group - حذف گروه از دیتابیس
/set_owner - تنظیم مالک ربات
    `);

  } catch (err) {
    console.error('Error in /start command:', err);
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
          console.error('Error updating quarantine status:', updateError);
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
          console.error('Error inserting quarantine status:', insertError);
          return ctx.reply('❌ خطا در ثبت قرنطینه کاربر.');
        }
      }

      userCache.delete(`quarantine_${userId}`);
      await kickUserFromAllGroupsExceptCurrent(userId, chatId);
      
      console.log(`User ${userId} quarantined in group ${chatId}`);

    } catch (error) {
      console.error('Error in quarantine process:', error);
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
        console.error('Error sending delayed message:', error);
      }
    }, delay_seconds * 1000);

  } catch (error) {
    console.error('Error in #ورود command:', error);
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
      console.error('Error updating quarantine status:', updateError);
      return ctx.reply('❌ خطا در به روز رسانی وضعیت قرنطینه.');
    }

    userCache.delete(`quarantine_${userId}`);
    
    await ctx.replyWithHTML(`🧭┊سفر به سلامت <b>${firstName}</b>`);
    
  } catch (error) {
    console.error('Error in #خروج command:', error);
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
    console.error('Error in /list_triggers command:', error);
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
      console.error('Error deleting trigger:', error);
      return ctx.reply('❌ خطا در حذف تریگر. لطفاً نام تریگر را بررسی کنید.');
    }

    await ctx.reply(`✅ تریگر "${triggerName}" با موفقیت حذف شد.`);
  } catch (error) {
    console.error('Error in /delete_trigger command:', error);
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
    console.error('Error in group_status command:', error);
    ctx.reply('❌ خطا در بررسی وضعیت گروه');
  }
});

// 🔥 دستور برای تنظیم مالک ربات
bot.command('set_owner', async (ctx) => {
  if (botOwnerId && ctx.from.id !== botOwnerId) {
    return ctx.reply('❌ فقط مالک فعلی می‌تواند مالک جدید تنظیم کند.');
  }
  
  botOwnerId = ctx.from.id;
  await ctx.reply(`✅ مالک جدید تنظیم شد: ${ctx.from.first_name}`);
  console.log(`Bot owner set to: ${botOwnerId}`);
});

// 🔥 دستور برای تنظیم گروه به عنوان ادمین در دیتابیس
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
      console.error('Error checking admin status:', error);
      return ctx.reply('❌ خطا در بررسی وضعیت ادمینی.');
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

// 🔥 دستور برای حذف گروه از دیتابیس
bot.command('remove_group', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    
    // فقط مالک می‌تواند گروه را حذف کند
    if (ctx.from.id !== botOwnerId) {
      return ctx.reply('❌ فقط مالک ربات می‌تواند گروه را حذف کند.');
    }

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
  if (botOwnerId && dbSize !== null) {
    await notifyOwner(
      `📊 گزارش منظم:\n` +
      `• حجم دیتابیس: ${dbSize}MB\n` +
      `• اندازه کش: ${cacheStats.size} آیتم\n` +
      `• نرخ hit کش: ${cacheStats.hitRatio}`
    );
  }
}, 6 * 60 * 60 * 1000); // هر 6 ساعت

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
});