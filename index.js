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

// کشینگ برای کاهش درخواست‌های دیتابیس
const cache = {
  releasedUsers: new Map(),
  groups: new Map(),
  lastCleanup: Date.now()
};

// تابع برای دریافت داده با کش
async function getCachedData(key, fetchFunction, ttl = 60000) {
  const cached = cache[key];
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }
  
  const data = await fetchFunction();
  cache[key] = { data, timestamp: Date.now() };
  return data;
}

// تابع برای پاکسازی کش هر 1 ساعت
setInterval(() => {
  cache.releasedUsers = new Map();
  cache.groups = new Map();
  cache.lastCleanup = Date.now();
  console.log('🧹 Cache cleared');
}, 60 * 60 * 1000);

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

// 🔥 هندلر جدید برای #فعال - ثبت گروه توسط ادمین
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

    // ذخیره گروه در دیتابیس
    const { error } = await supabase
      .from('groups')
      .upsert({
        chat_id: chatId,
        title: chatTitle,
        type: chatType,
        is_bot_admin: true,
        last_updated: new Date().toISOString()
      });

    if (error) {
      console.error('Error saving group:', error);
      return ctx.reply('❌ خطا در ثبت گروه. لطفاً بعداً تلاش کنید.');
    }

    // آپدیت کش
    cache.groups.set(chatId, {
      chat_id: chatId,
      title: chatTitle,
      type: chatType,
      is_bot_admin: true,
      last_updated: new Date().toISOString()
    });

    await ctx.reply(`✅ گروه "${chatTitle}" با موفقیت در سیستم ثبت شد!\n\n🔹 آی‌دی گروه: ${chatId}\n🔹 نوع گروه: ${chatType}\n🔹 وضعیت ربات: ادمین`);

  } catch (error) {
    console.error('Error in #فعال command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// 🔥 هندلر تقویت شده برای قرنطینه خودکار کاربران هنگام ورود به هر گروهی
bot.on('chat_member', async (ctx) => {
  try {
    const newMember = ctx.update.chat_member.new_chat_member;
    const userId = newMember.user.id;
    const chatId = ctx.chat.id;
    
    // فقط زمانی که کاربر به عنوان عضو جدید اضافه می‌شود
    if (newMember.status === 'member' || newMember.status === 'administrator') {
      // بررسی آیا کاربر در لیست released است (از کش استفاده می‌کنیم)
      const isReleased = cache.releasedUsers.has(userId);
      
      if (!isReleased) {
        // بررسی آیا ربات در این گروه ادمین است و حق بن کردن دارد
        try {
          const chatMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
          const isBotAdmin = chatMember.status === 'administrator' && chatMember.can_restrict_members;
          
          if (isBotAdmin) {
            // بن موقت کاربر از گروه (به مدت 7 روز)
            await ctx.telegram.banChatMember(chatId, userId, { 
              until_date: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // بن ۷ روزه
            });
            console.log(`🚫 کاربر ${userId} به طور خودکار از گروه ${chatId} بن موقت شد`);
          } else {
            console.log(`⚠️ ربات در گروه ${chatId} ادمین نیست یا حق بن کردن ندارد`);
          }
        } catch (banError) {
          console.error(`❌ خطا در بن کردن کاربر ${userId} در گروه ${chatId}:`, banError);
        }
      }
    }
  } catch (error) {
    console.error('Error in chat_member handler:', error);
  }
});

// دستور start
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
      await ctx.reply(`سلام ${firstName}! شما قبلاً در ربات ثبت شده‌اید. 😊`);
    } else {
      const { error } = await supabase
        .from('users')
        .insert([{ chat_id: chatId, first_name: firstName, username: username }]);

      if (error) {
        console.error('Supabase insert error:', error);
        return ctx.reply('⚠️ مشکلی در ثبت اطلاعات پیش آمد. لطفاً بعداً تلاش کنید.');
      }

      await ctx.reply(`سلام ${firstName}! به ربات خوش آمدی. 😊`);
    }

    // نمایش راهنمای دستورات
    await ctx.replyWithHTML(`
🤖 <b>دستورات disponibles:</b>
/set_trigger - تنظیم تریگر جدید
#خروج - غیرفعال کردن قرنطینه
#فعال - ثبت گروه در سیستم (فقط ادمین)
/list_triggers - مشاهده لیست تریگرها
/delete_trigger - حذف تریگر
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

// 🔥 تشخیص #خروج در هر جای متن - غیرفعال کردن قرنطینه
bot.hears(/.*#خروج.*/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    // افزودن کاربر به لیست released در کش
    cache.releasedUsers.set(userId, {
      user_id: userId,
      released_at: new Date().toISOString()
    });

    // آنبن کاربر از تمام گروه‌های ذخیره شده
    try {
      const groups = Array.from(cache.groups.values());
      
      if (groups && groups.length > 0) {
        for (const group of groups) {
          if (group.chat_id !== chatId && group.is_bot_admin) {
            try {
              await ctx.telegram.unbanChatMember(group.chat_id, userId);
              console.log(`✅ کاربر ${userId} از گروه ${group.title} آنبن شد`);
            } catch (unbanError) {
              console.error(`❌ خطا در آنبن کردن کاربر در گروه ${group.chat_id}:`, unbanError);
            }
          }
        }
      }
    } catch (unbanError) {
      console.error('Error in unban process:', unbanError);
    }

    await ctx.reply('✅ شما از قرنطینه خارج شدید و از این پس می‌توانید به همه گروه‌ها دسترسی داشته باشید.');
  } catch (error) {
    console.error('Error in #خروج command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// دستور برای نمایش لیست تریگرها
bot.command('list_triggers', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    
    // دریافت تمام تریگرهای گروه
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
      message += `${index + 1}. ${trigger.trigger_name}\n`;
      message += `   ⏰ تاخیر: ${trigger.delay_seconds} ثانیه\n`;
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
  try {
    const chatId = ctx.chat.id;
    const params = ctx.message.text.split(' ');
    
    if (params.length < 2) {
      return ctx.reply('⚠️ لطفاً نام تریگر را مشخص کنید. فرمت: /delete_trigger <نام تریگر>');
    }

    const triggerName = params.slice(1).join(' ');

    // حذف تریگر
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
  
  // لود اولیه داده‌ها از دیتابیس
  loadInitialData();
});

// تابع برای لود اولیه داده‌ها از دیتابیس
async function loadInitialData() {
  try {
    // لود گروه‌ها
    const { data: groups, error: groupsError } = await supabase
      .from('groups')
      .select('*');
    
    if (!groupsError && groups) {
      groups.forEach(group => {
        cache.groups.set(group.chat_id, group);
      });
      console.log(`✅ ${groups.length} گروه در حافظه کش شدند`);
    }
    
    // لود کاربران released (اگر در آینده ذخیره کنیم)
    // در حالتی که می‌خواهیم وضعیت را نگه داریم
    
  } catch (error) {
    console.error('Error loading initial data:', error);
  }
         }
