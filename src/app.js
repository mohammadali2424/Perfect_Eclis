const { buildBot } = require('./bot');
const { startServer } = require('./web/server');
const { config } = require('./config');

(async () => {
  const bot = await buildBot();
  await startServer(bot, config);
})();
