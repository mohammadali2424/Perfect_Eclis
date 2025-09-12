const { Telegraf } = require('telegraf');
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

// دستور start
bot.start(async (ctx) => {
  try {
    const chatId = ctx.message.chat.id;
    const firstName = ctx.message.chat.first_name || 'کاربر';
    const username = ctx.message.chat.username;

    // ذخیره کاربر در دیتابیس
    const { error } = await supabase
      .from('users')
      .insert([{ chat_id: chatId, first_name: firstName, username: username }]);

    if (error) {
      console.error('Supabase insert error:', error);
      return ctx.reply('سلام رفیق ، من ناظر اکلیسم ، ربات روشنه ✅');
    }

    // پاسخ به کاربر
    await ctx.reply(`سلام ${firstName}! به ربات خوش آمدی. 😊`);
  } catch (err) {
    console.error('Error in /start command:', err);
    ctx.reply('❌ خطای غیرمنتظره‌ای رخ داد.');
  }
});

// دستور trigger1
bot.command('trigger1', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const firstName = ctx.from.first_name || 'کاربر';

    // بررسی اینکه کاربر در حال حاضر قرنطینه نیست
    const { data: existingQuarantine, error: checkError } = await supabase
      .from('user_quarantine')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (existingQuarantine && existingQuarantine.is_quarantined) {
      return ctx.reply('⚠️ شما در حال حاضر قرنطینه هستید. برای خروج از قرنطینه از /trigger2 استفاده کنید.');
    }

    // دریافت تنظیمات از Supabase
    const { data: settings, error: settingsError } = await supabase
      .from('trigger_settings')
      .select('*')
      .eq('chat_id', chatId)
      .single();

    if (settingsError || !settings) {
      return ctx.reply('❌ تنظیمات تریگر یافت نشد. لطفاً ادمین تنظیمات را set کند.');
    }

    const { first_message, delay_seconds, second_message } = settings;

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
      console.error('Error saving quarantine:', quarantineError);
      return ctx.reply('❌ خطا در فعال کردن قرنطینه.');
    }

    // ارسال پیام اول و ریپلای
    await ctx.replyWithHTML(`👤 کاربر: <b>${firstName}</b>\n📝 پیام: ${first_message}\n⏰ تاخیر: ${delay_seconds} ثانیه`, {
      reply_to_message_id: ctx.message.message_id
    });

    // ارسال پیام دوم با تاخیر
    setTimeout(async () => {
      try {
        await ctx.telegram.sendMessage(chatId, `⏰ زمان تاخیر به پایان رسید!\n📝 پیام دوم: ${second_message}`, {
          reply_to_message_id: ctx.message.message_id
        });
      } catch (error) {
        console.error('Error sending delayed message:', error);
      }
    }, delay_seconds * 1000);

  } catch (error) {
    console.error('Error in /trigger1 command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// دستور trigger2
bot.command('trigger2', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    // بررسی اینکه کاربر قرنطینه است
    const { data: quarantine, error: quarantineError } = await supabase
      .from('user_quarantine')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!quarantine || !quarantine.is_quarantined) {
      return ctx.reply('❌ شما در حال حاضر قرنطینه نیستید.');
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
      console.error('Error updating quarantine:', updateError);
      return ctx.reply('❌ خطا در غیرفعال کردن قرنطینه.');
    }

    ctx.reply('✅ قرنطینه شما با موفقیت برداشته شد. اکنون می‌توانید به همه گروه‌ها دسترسی داشته باشید.');
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
