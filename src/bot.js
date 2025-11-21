const { Telegraf } = require('telegraf');
const config = require('./config');
const { register: registerTriggers } = require('./features/triggers');
const { register: registerGateActions } = require('./features/actions/gateActions');
const { register: registerLinkWizard } = require('./features/commands/linkWizard');

function buildBot(){
  const bot = new Telegraf(config.botToken, { handlerTimeout: 9000 });

  // حتماً config را پاس بده
  registerTriggers(bot, config);
  registerGateActions(bot, config);
  registerLinkWizard(bot, config);

  return bot;
}

module.exports = { buildBot };
