const { Telegraf, Scenes, session } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// بررسی وجود متغیرهای محیطی
console.log('🔍 Checking environment variables...');
const requiredEnvVars = ['BOT_TOKEN', 'SUPABASE_URL', 'SUPABASE_KEY'];
requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    console.error(`❌ ERROR: ${envVar} is not set!`);
    process.exit(1);
  } else {
    console.log(`✅ ${envVar}: Set`);
  }
});

// مقداردهی Supabase و Telegraf
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Telegraf(process.env.BOT_TOKEN);
console.log('✅ Telegraf and Supabase initialized');

// کش برای مدیریت کاربران قرنطینه
const quarantineCache = {
  users: new Map(),
  releasedUsers: new Map(),
  
  // لود داده‌ها از دیتابیس
  loadFromDatabase: async function() {
    try {
      console.log('🔄 Loading quarantine data from database...');
      
      // دریافت کاربران قرنطینه شده
      const { data: quarantinedUsers, error: quarantineError } = await supabase
        .from('user_quarantine')
        .select('user_id, quarantined_at')
        .eq('is_quarantined', true);
      
      if (quarantineError) throw quarantineError;
      
      // دریافت کاربران آزاد شده (24 ساعت اخیر)
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: releasedUsers, error: releasedError } = await supabase
        .from('user_quarantine')
        .select('user_id, released_at')
        .eq('is_quarantined', false)
        .gt('released_at', twentyFourHoursAgo);
      
      if (releasedError) throw releasedError;
      
      // پر کردن کش
      this.users.clear();
      this.releasedUsers.clear();
      
      quarantinedUsers.forEach(user => {
        this.users.set(user.user_id, { 
          timestamp: new Date(user.quarantined_at).getTime() 
        });
      });
      
      releasedUsers.forEach(user => {
        this.releasedUsers.set(user.user_id, { 
          timestamp: new Date(user.released_at).getTime() 
        });
      });
      
      console.log(`✅ Data loaded: ${this.users.size} quarantined, ${this.releasedUsers.size} released`);
    } catch (error) {
      console.error('❌ Error loading data:', error);
    }
  },
  
  // اضافه کردن کاربر به قرنطینه
  addUser: async function(userId) {
    const now = Date.now();
    this.users.set(userId, { timestamp: now });
    this.releasedUsers.delete(userId);
    
    try {
      const { error } = await supabase
        .from('user_quarantine')
        .upsert({
          user_id: userId,
          is_quarantined: true,
          quarantined_at: new Date(now).toISOString(),
          released_at: null
        });
      
      if (error) throw error;
      console.log(`✅ User ${userId} quarantined (saved to DB)`);
    } catch (error) {
      console.error(`❌ Error saving user ${userId}:`, error);
    }
  },
  
  // آزاد کردن کاربر از قرنطینه
  releaseUser: async function(userId) {
    if (!this.users.has(userId)) return;
    
    const now = Date.now();
    this.users.delete(userId);
    this.releasedUsers.set(userId, { timestamp: now });
    
    try {
      const { error } = await supabase
        .from('user_quarantine')
        .upsert({
          user_id: userId,
          is_quarantined: false,
          released_at: new Date(now).toISOString()
        });
      
      if (error) throw error;
      console.log(`✅ User ${userId} released (saved to DB)`);
    } catch (error) {
      console.error(`❌ Error releasing user ${userId}:`, error);
    }
  },
  
  // بررسی وضعیت قرنطینه کاربر
  isUserQuarantined: function(userId) {
    return this.users.has(userId) && !this.releasedUsers.has(userId);
  },
  
  // پاکسازی خودکار
  cleanup: function() {
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    
    for (const [userId, data] of this.releasedUsers.entries()) {
      if (now - data.timestamp > twentyFourHours) {
        this.releasedUsers.delete(userId);
      }
    }
  }
};

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
    ctx.wizard.state.delaySeconds = parseInt(ctx.message.text);
    if (isNaN(ctx.wizard.state.delaySeconds)) {
      await ctx.reply('⚠️ زمان باید یک عدد باشد. لطفاً دوباره وارد کنید:');
      return;
    }
    await ctx.reply('📝 لطفاً پیام اول را وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.firstMessage = ctx.message.text;
    if (ctx.message.entities) {
      ctx.wizard.state.firstMessageEntities = ctx.message.entities;
    }
    await ctx.reply('📩 لطفاً پیام تاخیری را وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.secondMessage = ctx.message.text;
    if (ctx.message.entities) {
      ctx.wizard.state.secondMessageEntities = ctx.message.entities;
    }
    
    const { error } = await supabase
      .from('trigger_settings')
      .upsert({
        chat_id: ctx.chat.id,
        trigger_name: ctx.wizard.state.triggerName,
        first_message: ctx.wizard.state.firstMessage,
        first_message_entities: ctx.wizard.state.firstMessageEntities || [],
        delay_seconds: ctx.wizard.state.delaySeconds,
        second_message: ctx.wizard.state.secondMessage,
        second_message_entities: ctx.wizard.state.secondMessageEntities || []
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

// سناریو برای مشاهده آمار
const statsScene = new Scenes.BaseScene('stats');
statsScene.enter(async (ctx) => {
  try {
    const totalQuarantined = quarantineCache.users.size;
    const totalReleased = quarantineCache.releasedUsers.size;

    const statsMessage = `
📊 آمار سیستم قرنطینه:

👥 کاربران قرنطینه: ${totalQuarantined}
✅ کاربران آزاد شده: ${totalReleased}

🕒 آخرین بروزرسانی: ${new Date().toLocaleTimeString('fa-IR')}
    `;

    await ctx.reply(statsMessage);
    ctx.scene.leave();
  } catch (error) {
    console.error('Error in stats scene:', error);
    await ctx.reply('❌ خطا در دریافت آمار.');
    ctx.scene.leave();
  }
});

const stage = new Scenes.Stage([setTriggerWizard, statsScene]);
bot.use(session());
bot.use(stage.middleware());

// هندلر برای #فعال
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

    // ذخیره در دیتابیس
    const { error: dbError } = await supabase
      .from('groups')
      .upsert({
        chat_id: chatId,
        title: chatTitle,
        type: chatType,
        registered_by: userId,
        registered_at: new Date().toISOString(),
        is_active: true
      });

    if (dbError) {
      console.error('Error saving group to database:', dbError);
      return ctx.reply('❌ خطا در ثبت گروه در دیتابیس.');
    }

    await ctx.reply(`✅ گروه "${chatTitle}" با موفقیت در سیستم ثبت شد!\n\n🔹 آی‌دی گروه: ${chatId}\n🔹 نوع گروه: ${chatType}`);
  } catch (error) {
    console.error('Error in #فعال command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// هندلر اصلی: حذف کاربران قرنطینه
bot.on('chat_member', async (ctx) => {
  try {
    const newMember = ctx.update.chat_member.new_chat_member;
    const userId = newMember.user.id;
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    
    if ((chatType === 'group' || chatType === 'supergroup') && 
        (newMember.status === 'member' || newMember.status === 'administrator')) {
      
      if (quarantineCache.isUserQuarantined(userId)) {
        try {
          const chatMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
          const canRestrict = chatMember.status === 'administrator' && chatMember.can_restrict_members;
          
          if (canRestrict) {
            await ctx.telegram.kickChatMember(chatId, userId);
            console.log(`🚫 User ${userId} removed from group ${chatId} (quarantine active)`);
          }
        } catch (error) {
          console.error(`❌ Error removing user ${userId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error in chat_member handler:', error);
  }
});

// قرنطینه خودکار کاربران جدید
bot.on('chat_member', async (ctx) => {
  try {
    const newMember = ctx.update.chat_member.new_chat_member;
    const userId = newMember.user.id;
    const chatType = ctx.chat.type;
    
    if ((chatType === 'group' || chatType === 'supergroup') && 
        newMember.status === 'member' &&
        !quarantineCache.isUserQuarantined(userId) &&
        !quarantineCache.releasedUsers.has(userId)) {
      
      await quarantineCache.addUser(userId);
      console.log(`✅ User ${userId} automatically quarantined`);
    }
  } catch (error) {
    console.error('Error in auto-quarantine handler:', error);
  }
});

// دستور start
bot.start(async (ctx) => {
  try {
    const firstName = ctx.message.chat.first_name || 'کاربر';

    await ctx.reply(`سلام ${firstName}! به ربات مدیریت قرنطینه خوش آمدی. 😊`);

    await ctx.replyWithHTML(`
🤖 <b>دستورات disponibles:</b>
/set_trigger - تنظیم تریگر جدید
/stats - مشاهده آمار سیستم
#خروج - خروج از قرنطینه
#فعال - ثبت گروه در سیستم (فقط ادمین)
    `);

  } catch (err) {
    console.error('Error in /start command:', err);
    ctx.reply('❌ خطای غیرمنتظره‌ای رخ داد.');
  }
});

// دستور stats
bot.command('stats', (ctx) => {
  ctx.scene.enter('stats');
});

// دستور set_trigger
bot.command('set_trigger', (ctx) => {
  ctx.scene.enter('set_trigger_wizard');
});

// تشخیص #خروج
bot.hears(/.*#خروج.*/, async (ctx) => {
  try {
    const userId = ctx.from.id;

    await quarantineCache.releaseUser(userId);
    
    await ctx.reply('✅ شما از قرنطینه خارج شدید و از این پس می‌توانید آزادانه به گروه‌ها وارد شوید.');
    
  } catch (error) {
    console.error('Error in #خروج command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

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

// راه‌اندازی سرور و لود داده‌ها
app.listen(PORT, async () => {
  console.log(`🤖 ربات در پورت ${PORT} راه‌اندازی شد...`);
  await quarantineCache.loadFromDatabase();
  console.log('✅ ربات آماده به کار است!');
});

// پاکسازی خودکار هر 24 ساعت
setInterval(() => {
  quarantineCache.cleanup();
}, 24 * 60 * 60 * 1000);
