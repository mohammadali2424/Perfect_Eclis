const { Telegraf } = require('telegraf');
const config = require('./config');
const { register: registerTriggers } = require('./features/triggers');
const { register: registerGateActions } = require('./features/actions/gateActions');
const { register: registerLinkWizard } = require('./features/commands/linkWizard');
const { register: registerHelp } = require('./features/commands/help');
const { logUpdates } = require('./middleware/logUpdates');

function buildBot() {
  const bot = new Telegraf(config.botToken, { handlerTimeout: 9000 });

  // لاگِ نوع آپدیت‌ها برای تشخیص اینکه اصلاً آپدیت می‌رسد یا نه
  bot.use(logUpdates());

  registerTriggers(bot, config);
  registerGateActions(bot, config);
  registerLinkWizard(bot, config);
  registerHelp(bot, config);

  return bot;
}

module.exports = { buildBot };
