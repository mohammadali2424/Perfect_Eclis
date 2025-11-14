// src/bot.js
const { Telegraf } = require('telegraf');
const triggers = require('./features/triggers');
const gateActions = require('./features/actions/gateActions');
const linkWizard = require('./features/commands/linkWizard');
const diag = require('./features/commands/diag'); // ← فایل جدیدِ دیباگ

function buildBot(config = {}) {
  const token = config.botToken || process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN is missing');

  const bot = new Telegraf(token, { handlerTimeout: 30_000 });
  global.bot = bot;

  // لاگ هویت بات
  bot.telegram.getMe()
    .then(me => console.log('🤖 Bot:', `@${me.username}`, `id=${me.id}`))
    .catch(err => console.log('getMe failed:', err?.message || err));

  // دیباگ ورودی‌ها (فقط اگر LOG_UPDATES=1)
  if (process.env.LOG_UPDATES === '1') {
    bot.use(async (ctx, next) => {
      try {
        console.log('… update:', ctx.updateType, ctx.chat?.type, ctx.from?.id);
      } catch {}
      return next();
    });
  }

  // ثبت فیچرها
  triggers.register(bot);
  gateActions.register(bot);
  linkWizard.register(bot);
  diag.register(bot); // ← /diag

  return bot; // launch نمی‌کنیم؛ فقط webhook در server.js
}

module.exports = { buildBot };
