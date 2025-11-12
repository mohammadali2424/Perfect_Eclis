// src/bot.js
//
// بوت‌استرپ اصلی ربات:
// - بارگذاری env
// - ساخت Telegraf bot
// - رجیسترکردن ماژول‌ها: #ورود (triggers)، Link Wizard، Gate Actions (کلیک روی مسیرها)، Relay Admin
// - پاسخ /start در PV: «نینجا در خدمت شماست 🥷🏻»
// - جلوگیری از اسپم و DropPendingUpdates برای جلوگیری از 409ها
// - هندل خطاها و خاموشی تمیز

require('dotenv').config();
const { Telegraf } = require('telegraf');

// --- ENV & Config ---
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN در env تنظیم نشده است.');
}
const OWNER_ID = Number(process.env.OWNER_ID || process.env.BOT_OWNER_ID || 0);
if (!OWNER_ID) {
  console.warn('⚠️ OWNER_ID تنظیم نشده—فرمان‌های ادمینی فقط با owner کار می‌کنند.');
}
const NODE_ENV = process.env.NODE_ENV || 'production';

const config = {
  ownerId: OWNER_ID,
  env: NODE_ENV,
};

// --- Bot ---
const bot = new Telegraf(BOT_TOKEN, {
  handlerTimeout: 90_000, // برای به‌روزرسانی‌هایی که طولانی می‌شوند
});

// برخی سرویس‌ها (مثل inviteService) به bot جهانی نیاز دارند
global.bot = bot;

// --- /start ---
bot.start(async (ctx) => {
  try {
    if (ctx.chat?.type === 'private') {
      await ctx.reply('نینجا در خدمت شماست 🥷🏻');
    } else {
      // اگر کسی اشتباهی در گروه زد، پاکش کنیم که تمیز بماند
      try { await ctx.deleteMessage(); } catch {}
    }
  } catch (e) {
    console.error('Error in /start:', e);
  }
});

// --- ثبت ماژول‌ها/فیچرها ---
try {
  // #ورود / #خروج → منوی مسیر در PV
  const { register: regTriggers } = require('./features/triggers');
  regTriggers(bot);

  // کلیک روی مسیرها، تولید بلیت/لینک/لغو حرکت، ردپا، …
  const { register: regGateActions } = require('./features/actions/gateActions');
  regGateActions(bot);

  // ویزارد لینک (داخل PV، یا در گروه با حذف پیام و شروع PV)
  const { register: regLinkWizard } = require('./features/commands/linkWizard');
  regLinkWizard(bot, config);

  // ادمینِ چراغ رله صفحات (اختیاری، ولی اگر فایلش را داری رجیستر شود)
  try {
    const { register: regRelay } = require('./features/commands/relayAdmin');
    regRelay(bot, config);
  } catch {
    // اگر فایل وجود نداشت، مشکلی نیست
  }

  // اگر بعداً ماژول‌های دیگری مثل pnav/pmenu اضافه کردی، اینجا رجیستر کن:
  // const { register: regPageNav } = require('./features/commands/pageNav');
  // regPageNav(bot);
} catch (e) {
  console.error('خطا در رجیستر ماژول‌ها:', e);
}

// --- خطاهای عمومی ---
bot.catch((err, ctx) => {
  try {
    const where = ctx?.updateType || 'unknown';
    console.error(`Unhandled error on ${where}:`, err);
  } catch (e) {
    console.error('Unhandled error (no ctx):', err);
  }
});

// --- Launch (Polling by default) ---
(async () => {
  try {
    // جلوگیری از صفِ آپدیت‌های قدیمی و 409
    await bot.launch({ dropPendingUpdates: true });
    const me = await bot.telegram.getMe();
    console.log(`🤖 Bot launched as @${me.username} (env: ${NODE_ENV})`);
  } catch (e) {
    console.error('Failed to launch bot:', e);
    process.exit(1);
  }
})();

// --- Graceful stop ---
process.once('SIGINT', () => {
  console.log('SIGINT received, stopping bot...');
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  console.log('SIGTERM received, stopping bot...');
  bot.stop('SIGTERM');
});
