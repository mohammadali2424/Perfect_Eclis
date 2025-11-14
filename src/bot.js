// src/bot.js (خلاصه)
const { Telegraf } = require('telegraf');
const linkWizard = require('./features/commands/linkWizard');
// ... بقیهٔ features

function buildBot(config) {
  const bot = new Telegraf(config.botToken);
  global.bot = bot;

  // features...
  linkWizard.register(bot);

  return bot; // نه launch و نه polling
}

module.exports = { buildBot };
