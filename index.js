// index.js
require('dotenv').config();

const start = require('./src/app'); // انتظار: module.exports = start

if (typeof start !== 'function') {
  console.error('❌ app export mismatch: expected a function from ./src/app');
  process.exit(1);
}

start().catch((err) => {
  console.error('Fatal startup error:', err?.stack || err?.message || err);
  process.exit(1);
});
