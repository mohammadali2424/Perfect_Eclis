// handlers/start.js
const { insertUser } = require('../services/supabase');

module.exports = (bot) => {
  bot.start(async (ctx) => {
    try {
      const chatId = ctx.message.chat.id;
      const firstName = ctx.message.chat.first_name || 'کاربر';
      const username = ctx.message.chat.username;

      // ذخیره کاربر در دیتابیس با استفاده از تابعی که در supabase.js تعریف کردیم
      await insertUser(chatId, firstName, username);

      // پاسخ به کاربر
      await ctx.reply(`سلام ${firstName}! به ربات خوش آمدی. 😊`);
    } catch (error) {
      console.error('Error in /start command:', error);
      // پاسخ به کاربر در صورت خطا
      try {
        await ctx.reply('سلام رفیق ، من ناظر اکلیس هستم ، ربات روشنه');
      } catch (e) {
        console.error('Could not send error message to user:', e);
      }
    }
  });
};