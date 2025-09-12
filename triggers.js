// handlers/triggers.js
const { getUserQuarantineStatus } = require('../services/supabase');

module.exports = (bot) => {
  // دستور /trigger1
  bot.command('trigger1', async (ctx) => {
    try {
      const userId = ctx.from.id;
      const chatId = ctx.chat.id;
      const firstName = ctx.from.first_name || 'کاربر';

      // بررسی وجود کاربر در قرنطینه
      const quarantineStatus = await getUserQuarantineStatus(userId);
      if (quarantineStatus && quarantineStatus.is_quarantined) {
        return ctx.reply('⚠️ شما در حال حاضر در قرنطینه هستید. برای خروج از قرنطینه از /trigger2 استفاده کنید.');
      }

      // منطق اصلی تریگر 1 اینجا implement شود
      // مثلاً ذخیره وضعیت جدید قرنطینه در دیتابیس، ارسال پیام‌ها و ...

      await ctx.reply(`✅ تریگر 1 برای ${firstName} فعال شد!`);
    } catch (error) {
      console.error('Error in /trigger1 command:', error);
      await ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
    }
  });

  // دستور /trigger2
  bot.command('trigger2', async (ctx) => {
    try {
      const userId = ctx.from.id;
      const firstName = ctx.from.first_name || 'کاربر';

      // بررسی وجود کاربر در قرنطینه
      const quarantineStatus = await getUserQuarantineStatus(userId);
      if (!quarantineStatus || !quarantineStatus.is_quarantined) {
        return ctx.reply('❌ شما در حال حاضر در قرنطینه نیستید.');
      }

      // منطق اصلی تریگر 2 اینجا implement شود
      // مثلاً آپدیت وضعیت قرنطینه کاربر در دیتابیس به "غیرفعال"

      await ctx.reply(`✅ تریگر 2 برای ${firstName} فعال شد و قرنطینه شما پایان یافت!`);
    } catch (error) {
      console.error('Error in /trigger2 command:', error);
      await ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
    }
  });
};