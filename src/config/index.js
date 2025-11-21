require('dotenv').config();

const cfg = {
  botToken: process.env.BOT_TOKEN,
  ownerId: Number(process.env.OWNER_ID || 0),
  renderUrl: process.env.RENDER_EXTERNAL_URL || '',
  port: Number(process.env.PORT || 3000),
};

if (!cfg.botToken) {
  console.error('Missing BOT_TOKEN');
  process.exit(1);
}
if (!cfg.ownerId) {
  console.warn('OWNER_ID not set; owner-only commands will be limited.');
}

module.exports = cfg;
