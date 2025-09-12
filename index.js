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
    // ذخیره پیام اول با تمام فرمت‌ها و لینک‌ها
    ctx.wizard.state.firstMessage = ctx.message.text;
    // اگر پیام حاوی entities باشد (مثل لینک، بولد، ایتالیک و...) آنها را نیز ذخیره می‌کنیم
    if (ctx.message.entities) {
      ctx.wizard.state.firstMessageEntities = ctx.message.entities;
    }
    await ctx.reply('📩 لطفاً پیام تاخیری را وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    // ذخیره پیام تاخیری با تمام فرمت‌ها و لینک‌ها
    ctx.wizard.state.secondMessage = ctx.message.text;
    if (ctx.message.entities) {
      ctx.wizard.state.secondMessageEntities = ctx.message.entities;
    }
    
    // ذخیره تمام تنظیمات در دیتابیس
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
      await ctx.replyWithHTML(`✅ تنظیمات تریگر با موفقیت ذخیره شد!\n\n📋 خلاصه تنظیمات:\n<b>نام:</b> ${ctx.wizard.state.triggerName}\n<b>تاخیر:</b> ${ctx.wizard.state.delaySeconds} ثانیه\n<b>پیام اول:</b> ${ctx.wizard.state.firstMessage}\n<b>پیام تاخیری:</b> ${ctx.wizard.state.secondMessage}`);
    }
    
    return ctx.scene.leave();
  }
);

// ثبت سناریو
const stage = new Scenes.Stage([setTriggerWizard]);
bot.use(session());
bot.use(stage.middleware());

// دستور start
bot.start(async (ctx) => {
  try {
    const chatId = ctx.message.chat.id;
    const firstName = ctx.message.chat.first_name || 'کاربر';
    const username = ctx.message.chat.username;

    // بررسی آیا کاربر قبلاً ثبت شده است
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (existingUser) {
      await ctx.reply(`سلام ${firstName}! شما قبلاً در ربات ثبت شده‌اید. 😊`);
    } else {
      // کاربر جدید - ذخیره در دیتابیس
      const { error } = await supabase
        .from('users')
        .insert([{ chat_id: chatId, first_name: firstName, username: username }]);

      if (error) {
        console.error('Supabase insert error:', error);
        return ctx.reply('⚠️ مشکلی در ثبت اطلاعات پیش آمد. لطفاً بعداً تلاش کنید.');
      }

      await ctx.reply(`سلام ${firstName}! به ربات خوش آمدی. 😊`);
    }
  } catch (err) {
    console.error('Error in /start command:', err);
    ctx.reply('❌ خطای غیرمنتظره‌ای رخ داد.');
  }
});

// دستور set_trigger - شروع فرآیند تنظیمات
bot.command('set_trigger', (ctx) => {
  ctx.scene.enter('set_trigger_wizard');
});

// دستور trigger1 - فعال کردن تریگر
bot.command('trigger1', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const firstName = ctx.from.first_name || 'کاربر';

    // دریافت تنظیمات از Supabase
    const { data: settings, error: settingsError } = await supabase
      .from('trigger_settings')
      .select('*')
      .eq('chat_id', chatId)
      .single();

    if (settingsError || !settings) {
      return ctx.reply('❌ تنظیمات تریگر یافت نشد. لطفاً ابتدا از /set_trigger استفاده کنید.');
    }

    const { trigger_name, first_message, delay_seconds, second_message } = settings;

    // 🔥 بخش جدید: قرنطینه کردن کاربر در همه گروه‌ها
    try {
      // این بخش نیاز به لیست کردن همه گروه‌های تحت مدیریت ربات دارد
      // برای نمونه، فرض می‌کنیم ربات در گروه‌های دیگر نیز عضو است
      
      // اینجا باید ID گروه‌هایی که می‌خواهید کاربر از آنها بن شود را جایگزین کنید
      const groupIdsToBan = [-1001234567890, -1009876543210]; // جایگزین کنید با ID گروه‌های واقعی
      
      for (const groupId of groupIdsToBan) {
        if (groupId !== chatId) { // از بن کردن کاربر در گروه فعلی خودداری کنید
          try {
            await ctx.telegram.banChatMember(groupId, userId, { 
              until_date: Math.floor(Date.now() / 1000) + (delay_seconds * 2) // بن به مدت دو برابر زمان تاخیر
            });
            console.log(`User ${userId} banned from group ${groupId}`);
          } catch (banError) {
            console.error(`Error banning user in group ${groupId}:`, banError);
          }
        }
      }
      
      // ذخیره وضعیت قرنطینه کاربر
      const { error: quarantineError } = await supabase
        .from('user_quarantine')
        .upsert({
          user_id: userId,
          chat_id: chatId,
          is_quarantined: true,
          quarantine_start: new Date().toISOString()
        });

      if (quarantineError) {
        console.error('Error saving quarantine status:', quarantineError);
      }
    } catch (banError) {
      console.error('Error in ban process:', banError);
    }

    // ارسال پیام اول - با حفظ فرمت و لینک‌ها
    await ctx.replyWithHTML(`🔔 <b>${trigger_name}</b> فعال شد!\n\n👤 کاربر: <b>${firstName}</b>\n⏰ تاخیر: ${delay_seconds} ثانیه\n\n${first_message}`, {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: 'HTML',
      disable_web_page_preview: false // اجازه نمایش پیش‌نمایش لینک
    });

    // ارسال پیام دوم با تاخیر - با حفظ فرمت و لینک‌ها
    setTimeout(async () => {
      try {
        await ctx.telegram.sendMessage(
          chatId, 
          `⏰ زمان تاخیر به پایان رسید!\n\n${second_message}`,
          {
            reply_to_message_id: ctx.message.message_id,
            parse_mode: 'HTML',
            disable_web_page_preview: false
          }
        );
      } catch (error) {
        console.error('Error sending delayed message:', error);
      }
    }, delay_seconds * 1000);

  } catch (error) {
    console.error('Error in /trigger1 command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// دستور trigger2 - غیرفعال کردن تریگر و آزاد کردن کاربر
bot.command('trigger2', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    // 🔥 بخش جدید: آزاد کردن کاربر از بن همه گروه‌ها
    try {
      const groupIdsToUnban = [-1001234567890, -1009876543210]; // جایگزین کنید با ID گروه‌های واقعی
      
      for (const groupId of groupIdsToUnban) {
        if (groupId !== chatId) {
          try {
            await ctx.telegram.unbanChatMember(groupId, userId);
            console.log(`User ${userId} unbanned from group ${groupId}`);
          } catch (unbanError) {
            console.error(`Error unbanning user in group ${groupId}:`, unbanError);
          }
        }
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
      }
    } catch (unbanError) {
      console.error('Error in unban process:', unbanError);
    }

    await ctx.reply('✅ تریگر غیرفعال شد و شما از قرنطینه خارج شدید.');
  } catch (error) {
    console.error('Error in /trigger2 command:', error);
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
