const { Telegraf } = require('telegraf');
const { config } = require('./config');
const { register: regTriggers } = require('./features/triggers');
const { register: regGate } = require('./features/actions/gateActions');
const { register: regMicro } = require('./features/actions/microActions');
const { register: regCancel } = require('./features/actions/cancelActions');
const { register: regNav } = require('./features/actions/navActions');
const { register: regAdmin } = require('./features/commands/adminCommands');
const { register: regMicroAdmin } = require('./features/commands/microAdmin');
const { register: regJoin } = require('./features/joinHandlers');

async function buildBot(){
  const bot = new Telegraf(config.botToken, { handlerTimeout: 9000 });
  global.bot = bot;

  bot.start((ctx)=>ctx.reply('نینجا در خدمت شماست 🥷🏻'));

  const me = await bot.telegram.getMe();
  regTriggers(bot, me);
  regGate(bot); regMicro(bot); regCancel(bot); regNav(bot);
  regAdmin(bot, config); regMicroAdmin(bot, config);
  regJoin(bot, config);

  return bot;
}
module.exports = { buildBot };
