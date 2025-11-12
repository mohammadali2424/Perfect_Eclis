// src/bot.js
// فقط bot را می‌سازد و ماژول‌ها را رجیستر می‌کند؛ launch اینجا انجام نمی‌شود.
// نکته: این فایل باید buildBot را export کند تا app.js بتواند صدا بزند.

const { Telegraf } = require('telegraf');

async function buildBot(config) {
  if (!config?.token) throw new Error('Token در config نیست.');
  const bot = new Telegraf(config.token, {
    handlerTimeout: 90_000,
  });

  // بعضی سرویس‌ها (مثلاً سازنده‌ی لینک دعوت) به bot جهانی نیاز دارند
  global.bot = bot;

  // /start در PV
  bot.start(async (ctx) => {
    try {
      if (ctx.chat?.type === 'private') {
        await ctx.reply('نینجا در خدمت شماست 🥷🏻');
      } else {
        try { await ctx.deleteMessage(); } catch {}
      }
    } catch (e) {
      console.error('Error in /start:', e);
    }
  });

  // رجیستر فیچرها
  try {
    // #ورود / #خروج → ارسال منوی مسیر در PV
    const { register: regTriggers } = require('./features/triggers');
    regTriggers(bot);

    // کلیک روی مسیرها، بلیت/لینک/لغو حرکت، ردپا
    const { register: regGateActions } = require('./features/actions/gateActions');
    regGateActions(bot);

    // ویزارد لینک (PV؛ یا در گروه با پاک‌کردن پیام و شروع PV)
    const { register: regLinkWizard } = require('./features/commands/linkWizard');
    regLinkWizard(bot, { ownerId: config.ownerId, env: config.env });

    // چراغ رله صفحات (اختیاری)
    try {
      const { register: regRelay } = require('./features/commands/relayAdmin');
      regRelay(bot, { ownerId: config.ownerId, env: config.env });
    } catch {
      // نداشتنش مشکلی ندارد
    }

    // اگر ناوبری صفحه و منوهای PV داری، اینجا اضافه کن:
    // const { register: regPageNav } = require('./features/commands/pageNav'); regPageNav(bot);
  } catch (e) {
    console.error('خطا در رجیستر ماژول‌ها:', e);
  }

  // خطای کلی
  bot.catch((err, ctx) => {
    try {
      const where = ctx?.updateType || 'unknown';
      console.error(`Unhandled error on ${where}:`, err);
    } catch (e) {
      console.error('Unhandled error (no ctx):', err);
    }
  });

  return bot;
}

module.exports = { buildBot };
