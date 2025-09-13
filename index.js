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

// مقداردهی Supabase و Telegraf
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Telegraf(process.env.BOT_TOKEN);

// کش برای مدیریت کاربران قرنطینه (بدون ذخیره در دیتابیس)
const quarantineCache = {
  users: new Map(), // کاربران در قرنطینه
  groups: new Map(), // گروه‌های ثبت شده
  releasedUsers: new Map(), // کاربران آزاد شده
  
  // اضافه کردن کاربر به قرنطینه
  addUser: function(userId) {
    this.users.set(userId, { timestamp: Date.now() });
    this.releasedUsers.delete(userId); // از لیست آزاد شده حذف شود
  },
  
  // آزاد کردن کاربر از قرنطینه
  releaseUser: function(userId) {
    this.users.delete(userId);
    this.releasedUsers.set(userId, { timestamp: Date.now() });
  },
  
  // بررسی آیا کاربر در قرنطینه است
  isUserQuarantined: function(userId) {
    return this.users.has(userId) && !this.releasedUsers.has(userId);
  },
  
  // پاکسازی خودکار هر 24 ساعت
  cleanup: function() {
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    
    // پاکسازی کاربران قدیمی
    for (const [userId, data] of this.users.entries()) {
      if (now - data.timestamp > twentyFourHours) {
        this.users.delete(userId);
      }
    }
    
    // پاکسازی کاربران آزاد شده قدیمی
    for (const [userId, data] of this.releasedUsers.entries()) {
      if (now - data.timestamp > twentyFourHours) {
        this.releasedUsers.delete(userId);
      }
    }
    
    console.log('🧹 کش قرنطینه پاکسازی شد');
  }
};

// پاکسازی خودکار هر 24 ساعت
setInterval(() => {
  quarantineCache.cleanup();
}, 24 * 60 * 60 * 1000);

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

// ثبت سناریو
const stage = new Scenes.Stage([setTriggerWizard]);
bot.use(session());
bot.use(stage.middleware());

// 🔥 هندلر برای #فعال - ثبت گروه توسط ادمین
bot.hears(/.*#فعال.*/, async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const chatType = ctx.chat.type;
    const chatTitle = ctx.chat.title || 'بدون نام';

    // فقط برای گروه‌ها و سوپرگروه‌ها
    if (chatType !== 'group' && chatType !== 'supergroup') {
      return ctx.reply('❌ این دستور فقط در گروه‌ها قابل استفاده است.');
    }

    // بررسی آیا کاربر ادمین است
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

    // ذخیره گروه در کش (بدون دیتابیس)
    quarantineCache.groups.set(chatId, {
      chat_id: chatId,
      title: chatTitle,
      type: chatType,
      is_bot_admin: true,
      last_updated: Date.now()
    });

    await ctx.reply(`✅ گروه "${chatTitle}" با موفقیت در سیستم ثبت شد!\n\n🔹 آی‌دی گروه: ${chatId}\n🔹 نوع گروه: ${chatType}`);
  } catch (error) {
    console.error('Error in #فعال command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// 🔥 هندلر اصلی: حذف کاربران قرنطینه از گروه‌ها
bot.on('chat_member', async (ctx) => {
  try {
    const newMember = ctx.update.chat_member.new_chat_member;
    const userId = newMember.user.id;
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    
    // فقط برای گروه‌ها و سوپرگروه‌ها و زمانی که کاربر عضو می‌شود
    if ((chatType === 'group' || chatType === 'supergroup') && 
        (newMember.status === 'member' || newMember.status === 'administrator')) {
      
      // بررسی آیا کاربر در قرنطینه است
      if (quarantineCache.isUserQuarantined(userId)) {
        // بررسی آیا ربات در این گروه ادمین است و حق حذف کاربران را دارد
        try {
          const chatMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
          const canRestrict = chatMember.status === 'administrator' && chatMember.can_restrict_members;
          
          if (canRestrict) {
            // حذف کاربر از گروه (بدون بن کردن)
            await ctx.telegram.kickChatMember(chatId, userId);
            console.log(`🚫 کاربر ${userId} از گروه ${chatId} حذف شد (قرنطینه فعال)`);
          } else {
            console.log(`⚠️ ربات در گروه ${chatId} ادمین نیست یا حق حذف کاربران را ندارد`);
          }
        } catch (error) {
          console.error(`❌ خطا در حذف کاربر ${userId} از گروه ${chatId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error in chat_member handler:', error);
  }
});

// 🔥 کاربر به محض ورود به هر گروهی، به طور خودکار در قرنطینه قرار می‌گیرد
bot.on('chat_member', async (ctx) => {
  try {
    const newMember = ctx.update.chat_member.new_chat_member;
    const userId = newMember.user.id;
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    
    // وقتی کاربر برای اولین بار به هر گروهی اضافه می‌شود
    if ((chatType === 'group' || chatType === 'supergroup') && 
        newMember.status === 'member' &&
        !quarantineCache.isUserQuarantined(userId) &&
        !quarantineCache.releasedUsers.has(userId)) {
      
      // کاربر را به قرنطینه اضافه کن
      quarantineCache.addUser(userId);
      console.log(`✅ کاربر ${userId} به طور خودکار به قرنطینه اضافه شد`);
    }
  } catch (error) {
    console.error('Error in auto-quarantine handler:', error);
  }
});

// دستور start
bot.start(async (ctx) => {
  try {
    const chatId = ctx.message.chat.id;
    const firstName = ctx.message.chat.first_name || 'کاربر';

    await ctx.reply(`سلام ${firstName}! به ربات مدیریت قرنطینه خوش آمدی. 😊`);

    // نمایش راهنمای دستورات
    await ctx.replyWithHTML(`
🤖 <b>دستورات disponibles:</b>
/set_trigger - تنظیم تریگر جدید
#خروج - خروج از قرنطینه
#فعال - ثبت گروه در سیستم (فقط ادمین)
    `);

  } catch (err) {
    console.error('Error in /start command:', err);
    ctx.reply('❌ خطای غیرمنتظره‌ای رخ داد.');
  }
});

// دستور set_trigger - شروع فرآیند تنظیمات
bot.command('set_trigger', (ctx) => {
  ctx.scene.enter('set_trigger_wizard');
});

// 🔥 تشخیص #خروج در هر جای متن - خروج از قرنطینه
bot.hears(/.*#خروج.*/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    // آزاد کردن کاربر از قرنطینه
    quarantineCache.releaseUser(userId);
    
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

// راه‌اندازی سرور
app.listen(PORT, () => {
  console.log(`🤖 ربات در پورت ${PORT} راه‌اندازی شد...`);
});
