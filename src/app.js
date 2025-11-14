// src/app.js
require('dotenv').config();

const { buildBot } = require('./bot');
const { startServer } = require('./web/server');

// اگر Supabase کلاینتت جای دیگری init می‌شود، این بخش را برحسب پروژه‌ات نگه‌دار/تغییر بده
try {
  const { initSupabase } = require('./infra/supabase');
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('⚠️ SUPABASE_URL / SUPABASE_* تنظیم نشده. اگر جای دیگری init می‌کنی، مشکلی نیست.');
  } else {
    initSupabase(SUPABASE_URL, SUPABASE_KEY);
  }
} catch (_) {
  // اگر پروژه‌ات فایل initSupabase ندارد، مشکلی نیست.
}

async function start() {
  const config = {
    botToken: process.env.BOT_TOKEN,
    publicUrl: (process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),
    port: Number(process.env.PORT || 3000),
  };

  if (!config.botToken) {
    console.error('❌ BOT_TOKEN تنظیم نشده. آن را در env Render ست کن.');
    process.exit(1);
  }

  // ساخت Bot (بدون launch/polling)
  const bot = buildBot(config);

  // فقط Webhook (بدون fallback به polling)
  startServer(bot, {
    publicUrl: config.publicUrl,
    port: config.port,
  });
}

module.exports = { start };
