// src/bot.js
const { Telegraf } = require('telegraf');

function safeRequire(path) {
  try { return require(path); }
  catch (e) { console.warn(`⚠️ optional feature missing: ${path} (${e.code || e.message})`); return null; }
}

const triggers    = safeRequire('./features/triggers');
const gateActions = safeRequire('./features/actions/gateActions');
const linkWizard  = safeRequire('./features/commands/linkWizard');

function buildBot(config = {}) {
  const token = config.botToken || process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN is missing');

  const bot = new Telegraf(token, { handlerTimeout: 30_000 });
  global.bot = bot;

  bot.telegram.getMe()
    .then(me => { global.BOT_UNAME = me.username; console.log('🤖 Bot:', `@${me.username}`, `id=${me.id}`); })
    .catch(err => console.log('getMe failed:', err?.message || err));

  if (process.env.LOG_UPDATES === '1') {
    bot.use(async (ctx, next) => {
      try { console.log('… update:', ctx.updateType, ctx.chat?.type, ctx.from?.id); } catch {}
      return next();
    });
  }

  if (triggers?.register)    triggers.register(bot);
  if (gateActions?.register) gateActions.register(bot);
  if (linkWizard?.register)  linkWizard.register(bot);

  return bot; // launch ندارد؛ webhook در server.js تنظیم می‌شود
}

module.exports = { buildBot };
