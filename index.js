// index.js
require('dotenv').config();
const { start } = require('./src/app');

start().catch((err) => {
  console.error('Fatal startup error:', err?.message || err);
  process.exit(1);
});
