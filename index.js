const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// توکن ربات خود را از @BotFather دریافت کنید
const TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://your-app-name.onrender.com';

// ایجاد نمونه ربات
const bot = new TelegramBot(TOKEN);

// ایجاد سرور Express برای Render
const app = express();

// میدلور برای پردازش JSON
app.use(express.json());

// هندلر برای دستور /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name;
  
  const welcomeMessage = `
👋 سلام ${firstName}!

🤖 به ربات من خوش آمدید!

✅ ربات با موفقیت فعال شد.

💡 از دستورات زیر می‌توانید استفاده کنید:
/help - راهنما
/about - درباره ربات
  `;
  
  bot.sendMessage(chatId, welcomeMessage, {
    reply_markup: {
      keyboard: [
        ['/help', '/about'],
        ['🚀 شروع']
      ],
      resize_keyboard: true
    }
  });
});

// هندلر برای دستور /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '📖 این بخش راهنما است. ربات با دستور /start فعال می‌شود.');
});

// هندلر برای دستور /about
bot.onText(/\/about/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🤖 این یک ربات نمونه است که با Node.js ساخته شده است.');
});

// هندلر برای پیام‌های متنی معمولی
bot.on('message', (msg) => {
  if (!msg.text.startsWith('/')) {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `📩 شما گفتید: ${msg.text}`);
  }
});

// راه‌اندازی وب‌هوک برای Render
if (process.env.NODE_ENV === 'production') {
  app.post('/webhook', (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    
    // تنظیم وب‌هوک
    try {
      await bot.setWebHook(`${WEBHOOK_URL}/webhook`);
      console.log('✅ Webhook set successfully');
    } catch (error) {
      console.error('❌ Error setting webhook:', error);
    }
  });
} else {
  // حالت polling برای توسعه
  bot.startPolling();
  console.log('🤖 Bot is running in polling mode...');
}

// Route سلامت برای Render
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Telegram Bot is running!',
    timestamp: new Date().toISOString()
  });
});

// هندلر خطا
bot.on('error', (error) => {
  console.error('❌ Bot error:', error);
});

console.log('✅ Bot started successfully!');
