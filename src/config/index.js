// src/config/index.js
require('dotenv').config();

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

const cfg = {
  // Telegram
  botToken: process.env.BOT_TOKEN || '',
  ownerId: num(process.env.OWNER_ID || 0),

  // Webhook / Render
  renderUrl: process.env.RENDER_EXTERNAL_URL || '',
  port: num(process.env.PORT || 3000),

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL || '',
  // یکی از این دو را تنظیم کن: SERVICE_ROLE یا ANON
  supabaseKey:
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    '',
};

// --- اعتبارسنجی‌های ضروری ---
let fatal = false;

if (!cfg.botToken) {
  console.error('❌ Missing BOT_TOKEN in environment.');
  fatal = true;
}

if (!cfg.supabaseUrl) {
  console.error('❌ Missing SUPABASE_URL in environment.');
  fatal = true;
}

if (!cfg.supabaseKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY in environment.');
  fatal = true;
}

if (fatal) process.exit(1);

if (!cfg.ownerId) {
  console.warn('⚠️ OWNER_ID not set; owner-only commands may be limited.');
}

module.exports = cfg;
