const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// بررسی متغیرهای محیطی
if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is missing!');
  process.exit(1);
}
if (!process.env.SUPABASE_URL) {
  console.error('❌ SUPABASE_URL is missing!');
  process.exit(1);
}
if (!process.env.SUPABASE_KEY) {
  console.error('❌ SUPABASE_KEY is missing!');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Middleware برای پردازش JSON
app.use(express.json());

// دستور برای تنظیم پیام‌ها و زمان تاخیر توسط ادمین
bot.command('set_trigger_settings', async (ctx) => {
  const chatId = ctx.chat.id;
  const isAdmin = await checkAdmin(ctx.from.id); // تابع چک کردن ادمین ( باید پیاده‌سازی شود )
  if (!isAdmin) {
    return ctx.reply('❌ فقط ادمین می‌تواند این دستور را اجرا کند.');
  }

  const [_, firstMessage, delay, secondMessage] = ctx.message.text.split('|').map(item => item.trim());
  if (!firstMessage || !delay || !secondMessage) {
    return ctx.reply('⚠️ فرمت دستور: /set_trigger_settings <پیام اول> | <زمان تاخیر به ثانیه> | <پیام دوم>');
  }

  // ذخیره تنظیمات در Supabase
  const { error } = await supabase
    .from('trigger_settings')
    .upsert({ 
      chat_id: chatId, 
      first_message: firstMessage, 
      delay_seconds: parseInt(delay), 
      second_message: secondMessage 
    });

  if (error) {
    console.error('Error saving settings:', error);
    return ctx.reply('❌ خطا در ذخیره تنظیمات.');
  }

  ctx.reply('✅ تنظیمات با موفقیت ذخیره شد.');
});

// تریگر اول: فعال کردن قرنطینه
bot.command('trigger1', async (ctx) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const messageId = ctx.message.message_id;

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
  await ctx.replyWithHTML(`👤 کاربر: <b>${ctx.from.first_name}</b>\n📝 پیام: ${first_message}\n⏰ تاخیر: ${delay_seconds} ثانیه`, {
    reply_to_message_id: messageId
  });

  // بن موقت کاربر در همه گروه‌ها به جز گروه فعلی
  // NOTE: این بخش نیاز به دسترسی ربات به همه گروه‌ها و لیست کردن آن‌ها دارد. 
  // در این مثال، فرض می‌شود که ربات در گروه‌های دیگر نیز هست و می‌تواند کاربر را بن کند.
  // برای پیاده‌سازی کامل، باید لیست تمام گروه‌های managed توسط ربات را از دیتابیس بگیرید.
  // اینجا یک نمونه ساده آورده شده:

  // const allChats = await getAllChats(); // تابعی که همه گروه‌ها را برمی‌گرداند ( باید پیاده‌سازی شود )
  // for (const chat of allChats) {
  //   if (chat.id !== chatId) {
  //     try {
  //       await bot.telegram.banChatMember(chat.id, userId, { until_date: Math.floor(Date.now() / 1000) + delay_seconds });
  //     } catch (error) {
  //       console.error(`Error banning user in chat ${chat.id}:`, error);
  //     }
  //   }
  // }

  // ارسال پیام دوم با تاخیر
  setTimeout(async () => {
    try {
      await ctx.telegram.sendMessage(chatId, `⏰ زمان تاخیر به پایان رسید!\n📝 پیام دوم: ${second_message}`, {
        reply_to_message_id: messageId
      });
    } catch (error) {
      console.error('Error sending delayed message:', error);
    }
  }, delay_seconds * 1000);
});

// تریگر دوم: غیرفعال کردن قرنطینه
bot.command('trigger2', async (ctx) => {
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

  // برداشتن بن کاربر از همه گروه‌ها
  // NOTE: مشابه بخش بن، باید همه گروه‌ها را iterate کنیم و کاربر را unban کنیم.
  // const allChats = await getAllChats();
  // for (const chat of allChats) {
  //   if (chat.id !== chatId) {
  //     try {
  //       await bot.telegram.unbanChatMember(chat.id, userId);
  //     } catch (error) {
  //       console.error(`Error unbanning user in chat ${chat.id}:`, error);
  //     }
  //   }
  // }

  // به روز رسانی وضعیت قرنطینه کاربر
  const { error: updateError } = await supabase
    .from('user_quarantine')
    .update({ is_quarantined: false, quarantine_end: new Date().toISOString() })
    .eq('user_id', userId);

  if (updateError) {
    console.error('Error updating quarantine:', updateError);
    return ctx.reply('❌ خطا در غیرفعال کردن قرنطینه.');
  }

  ctx.reply('✅ قرنطینه شما با موفقیت برداشته شد. اکنون می‌توانید به همه گروه‌ها دسترسی داشته باشید.');
});

// مسیر webhook برای دریافت به‌روزرسانی‌ها از تلگرام
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
  console.log(`🚀 Server running on port ${PORT}`);
});
