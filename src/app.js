// src/bot.js
const { Telegraf } = require('telegraf');

// این requireها را برحسب پروژه‌ات نگه دار:
try { global.botFeaturesLoaded = true; } catch (_) {}

const triggers = require('./features/triggers');
const gateActions = require('./features/actions/gateActions');
const linkWizard = require('./features/commands/linkWizard');
// اگر builder داری:
// const builder = require('./features/commands/builder');

function buildBot(config = {}) {
  const token = config.botToken || process.env.BOT_TOKEN;
  if (!token) {
    throw new Error('BOT_TOKEN is missing (config.botToken یا ENV).');
  }

  const bot = new Telegraf(token, { handlerTimeout: 30_000 });
  global.bot = bot;

  // ثبت فیچرها — فقط نمونه، آنهایی که در پروژه‌ات هست را نگه دار
  triggers.register(bot);
  gateActions.register(bot);
  linkWizard.register(bot);
  // اگر builder داری: builder.register(bot);

  // هیچ bot.launch() اینجا وجود ندارد. فقط وبهوک در server.js تنظیم می‌شود.
  return bot;
}

module.exports = { buildBot };
