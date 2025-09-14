const { Telegraf, Scenes, session } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// بررسی وجود متغیرهای محیطی
const requiredEnvVars = ['BOT_TOKEN', 'SUPABASE_URL', 'SUPABASE_KEY'];
requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    console.error(`❌ ERROR: ${envVar} is not set!`);
    process.exit(1);
  }
});

// مقداردهی Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Telegraf(process.env.BOT_TOKEN);

// کش پیشرفته برای مدیریت حافظه
class AdvancedCache {
  constructor() {
    this.cache = new Map();
  }
  
  set(key, value, ttl = 300000) {
    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
      ttl: ttl
    });
  }
  
  get(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }
  
  clear() {
    this.cache.clear();
  }
}

const cache = new AdvancedCache();

// سیستم مدیریت منابع
class ResourceManager {
  constructor() {
    this.requestCount = 0;
    this.lastReset = Date.now();
  }
  
  trackRequest() {
    this.requestCount++;
    
    // بازنشانی شمارنده هر ساعت
    if (Date.now() - this.lastReset > 3600000) {
      this.requestCount = 0;
      this.lastReset = Date.now();
    }
    
    // فعال کردن کش تهاجمی اگر درخواست‌ها زیاد باشد
    if (this.requestCount > 500) {
      this.enableAggressiveCaching();
    }
  }
  
  enableAggressiveCaching() {
    // افزایش زمان کش برای کاهش درخواست‌ها
    console.log('🔄 فعال کردن کش تهاجمی برای صرفه‌جویی در منابع');
  }
}

const resourceManager = new ResourceManager();

// توابع اصلی
async function checkUserQuarantine(userId) {
  const cacheKey = `quarantine_${userId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  
  resourceManager.trackRequest();
  const { data: quarantine, error } = await supabase
    .from('user_quarantine')
    .select('*')
    .eq('user_id', userId)
    .eq('is_quarantined', true)
    .single();

  if (!error && quarantine) {
    cache.set(cacheKey, quarantine, 300000); // 5 دقیقه کش
    return quarantine;
  }
  
  return null;
}

async function checkBotAdminStatus(chatId) {
  const cacheKey = `bot_admin_${chatId}`;
  const cached = cache.get(cacheKey);
  if (cached !== null) return cached;
  
  try {
    resourceManager.trackRequest();
    const { data: group, error } = await supabase
      .from('groups')
      .select('is_bot_admin')
      .eq('chat_id', chatId)
      .single();

    if (!error && group) {
      cache.set(cacheKey, group.is_bot_admin, 60000); // 1 دقیقه کش
      return group.is_bot_admin;
    }

    // بررسی مستقیم از تلگرام
    const botMember = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    const isAdmin = botMember.status === 'administrator' && botMember.can_restrict_members;
    
    // ذخیره در دیتابیس
    await supabase
      .from('groups')
      .upsert({
        chat_id: chatId,
        is_bot_admin: isAdmin,
        last_updated: new Date().toISOString()
      });

    cache.set(cacheKey, isAdmin, 60000); // 1 دقیقه کش
    return isAdmin;
  } catch (error) {
    console.error('Error checking bot admin status:', error);
    return false;
  }
}

async function kickUserFromGroup(chatId, userId, reason = 'قرنطینه فعال') {
  try {
    const isBotAdmin = await checkBotAdminStatus(chatId);
    if (!isBotAdmin) {
      console.log(`⚠️ ربات در گروه ${chatId} ادمین نیست`);
      return false;
    }
    
    await bot.telegram.kickChatMember(chatId, userId);
    console.log(`✅ کاربر ${userId} از گروه ${chatId} کیک شد`);
    
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

// تعریف سناریو برای تنظیمات تریگر
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
      await ctx.reply('⚠️ زمان باید یک عدد مثب�� باشد. لطفاً دوباره وارد کنید:');
      return;
    }
    
    ctx.wizard.state.delaySeconds = delaySeconds;
    await ctx.reply('📩 لطفاً پیام تاخیری را وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.secondMessage = ctx.message.text;
    
    resourceManager.trackRequest();
    const { error } = await supabase
      .from('trigger_settings')
      .upsert({
        chat_id: ctx.chat.id,
        trigger_name: ctx.wizard.state.triggerName,
        delay_seconds: ctx.wizard.state.delaySeconds,
        second_message: ctx.wizard.state.secondMessage
      });

    if (error) {
      console.error('Error saving trigger settings:', error);
      await ctx.reply('❌ خطا در ذخیره تنظیمات.');
    } else {
      await ctx.replyWithHTML(`✅ تنظیمات تریگر با موفقیت ذخیره شد!\n\n📋 خلاصه تنظیمات:\n<b>نام:</b> ${ctx.wizard.state.triggerName}\n<b>تاخیر:</b> ${ctx.wizard.state.delaySeconds} ثانیه`);
    }
    
    return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage([setTriggerWizard]);
bot.use(session());
bot.use(stage.middleware());

// 🔥 هندلر ثبت گروه
bot.hears(/.*#فعال.*/, async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const chatType = ctx.chat.type;
    const chatTitle = ctx.chat.title || 'بدون نام';

    if (chatType !== 'group' && chatType !== 'supergroup') {
      return ctx.reply('❌ این دستور فقط در گروه‌ها قابل استفاده است.');
    }

    // بررسی آیا کاربر ادمین است
    const chatMember = await ctx.telegram.getChatMember(chatId, userId);
    const isAdmin = ['administrator', 'creator'].includes(chatMember.status);
    
    if (!isAdmin) {
      return ctx.reply('❌ فقط ادمین‌های گروه می‌توانند از این دستور استفاده کنند.');
    }

    // بررسی وضعیت ادمین بودن ربات
    const botMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
    const isBotAdmin = botMember.status === 'administrator' && botMember.can_restrict_members;

    resourceManager.trackRequest();
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

    cache.delete(`bot_admin_${chatId}`);
    await ctx.reply(`✅ گروه "${chatTitle}" با موف��یت در سیستم ثبت شد!`);

  } catch (error) {
    console.error('Error in #فعال command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// 🔥 هندلر بررسی وضعیت ربات در گروه
bot.on('my_chat_member', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const newStatus = ctx.update.my_chat_member.new_chat_member.status;
    const chatTitle = ctx.chat.title || 'بدون نام';
    const chatType = ctx.chat.type;

    if (chatType === 'group' || chatType === 'supergroup') {
      const isBotAdmin = newStatus === 'administrator';
      
      resourceManager.trackRequest();
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
        console.log(`✅ وضعیت گروه به روز شد: ${chatTitle} - ادمین: ${isBotAdmin}`);
        cache.delete(`bot_admin_${chatId}`);
      }
    }
  } catch (error) {
    console.error('Error in my_chat_member handler:', error);
  }
});

// 🔥 هندلر کاربران جدید
bot.on('new_chat_members', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    
    for (const newMember of ctx.message.new_chat_members) {
      const userId = newMember.id;
      if (newMember.is_bot) continue;

      // بررسی دسترسی ربات
      const isBotAdmin = await checkBotAdminStatus(chatId);
      if (!isBotAdmin) {
        console.log(`⚠️ ربات در گروه ${chatId} ادمین نیست`);
        continue;
      }

      // بررسی قرنطینه کاربر
      const quarantine = await checkUserQuarantine(userId);
      if (quarantine && quarantine.chat_id !== chatId) {
        await kickUserFromGroup(chatId, userId);
        continue;
      }
      
      // قرنطینه کاربر جدید
      resourceManager.trackRequest();
      await supabase
        .from('user_quarantine')
        .upsert({
          user_id: userId,
          chat_id: chatId,
          is_quarantined: true,
          username: newMember.username,
          first_name: newMember.first_name,
          quarantine_start: new Date().toISOString()
        });

      cache.delete(`quarantine_${userId}`);
      console.log(`✅ کاربر ${userId} قرنطینه شد`);
    }
  } catch (error) {
    console.error('Error in new_chat_members handler:', error);
  }
});

// سایر هندلرها (شروع، #ورود، #خروج، etc.)
// [کدهای قبلی مربوط به start، #ورود، #خروج و ... اینجا قرار می‌گیرد]

// middleware و راه‌اندازی سرور
app.use(express.json());
app.post('/webhook', async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
  } catch (error) {
    console.error('Error handling update:', error);
    res.status(200).send();
  }
});

app.listen(PORT, () => {
  console.log(`🤖 ربات در پورت ${PORT} راه‌اندازی شد...`);
});

// تابع برای پاکسازی داده‌های قدیمی
async function cleanupOldData() {
  try {
    // حذف کاربران قرنطینه شده قدیمی
    const { error: quarantineError } = await supabase
      .from('user_quarantine')
      .delete()
      .lt('quarantine_start', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    if (quarantineError) {
      console.error('Error cleaning old quarantine data:', quarantineError);
    }

    // حذف گروه‌های غیرفعال
    const { error: groupsError } = await supabase
      .from('groups')
      .delete()
      .lt('last_updated', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .eq('is_bot_admin', false);

    if (groupsError) {
      console.error('Error cleaning old groups data:', groupsError);
    }

    console.log('✅ داده‌های قدیمی پاکسازی شدند');
  } catch (error) {
    console.error('Error in cleanup:', error);
  }
}

// اجرای پاکسازی هر 24 ساعت
setInterval(cleanupOldData, 24 * 60 * 60 * 1000);
