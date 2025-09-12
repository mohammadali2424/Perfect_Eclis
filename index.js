// index.js
const { Telegraf } = require('telegraf');
const express = require('express');

// ایمپورت هندلرها
const startHandler = require('./handlers/start');
const triggersHandler = require('./handlers/triggers');

const app = express();
const PORT = process.env.PORT || 3000;

// بررسی متغیرهای محیطی
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

// مقداردهی ربات
const bot = new Telegraf(process.env.BOT_TOKEN);

// ثبت هندلرها
startHandler(bot);
triggersHandler(bot);
// اگر هندلرهای دیگری دارید، آنها را اینجا اضافه کنید

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
