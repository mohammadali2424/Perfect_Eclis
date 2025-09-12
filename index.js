// بوت تلگرام با Supabase - توسط شما ساخته شد!
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

// ساخت برنامه اکسپرس و تعریف پورت
const app = express();
const PORT = process.env.PORT || 3000;

// چک کردن متغیرهای محیطی (اگر کسی توکن را ست نکرده باشد خطا می دهد)
if (!process.env.BOT_TOKEN) {
  console.error('❌ ERROR: BOT_TOKEN is missing!');
  process.exit(1);
}
if (!process.env.SUPABASE_URL) {
  console.error('❌ ERROR: SUPABASE_URL is missing!');
  process.exit(1);
}
if (!process.env.SUPABASE_KEY) {
  console.error('❌ ERROR: SUPABASE_KEY is missing!');
  process.exit(1);
}

// مقداردهی ربات و سوپابیس
const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// وقتی کاربر /start می زند این تابع اجرا می شود
bot.start(async (ctx) => {
  try {
    const chatId = ctx.message.chat.id;
    const firstName = ctx.message.chat.first_name;
    const username = ctx.message.chat.username;

    // اطلاعات کاربر را در دیتابیس ذخیره کن
    const { data, error } = await supabase
      .from('users')
      .insert([{ chat_id: chatId, first_name: firstName, username: username }]);

    if (error) {
      console.error('Error saving user:', error);
      await ctx.reply('متاسفانه مشکلی پیش آمد. لطفاً بعداً تلاش کنید.');
      return;
    }

    // اگر همه چیز اوکی بود، این پیام را بفرست
    await ctx.reply(`سلام ${firstName}! به ربات من خوش آمدی. 🙂`);
  } catch (err) {
    console.error('Unexpected error:', err);
    await ctx.reply('یک خطای غیرمنتظره رخ داد.');
  }
});

// این وسطیware برای پردازش JSON است
app.use(express.json());

// این مسیر اصلی برای دریافت پیام ها از تلگرام است
app.post('/webhook', async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
  } catch (error) {
    console.error('Error in webhook:', error);
    res.status(200).send(); 
  }
});

// سرور را روی پورت مشخص شده راه اندازی کن
app.listen(PORT, () => {
  console.log(`✅ Robot is running on port ${PORT}`);
});