// src/config/index.js

// این ماژول فقط مسئول خواندن و اعتبارسنجی ENV است.
// سعی می‌کنیم هم نام‌های قدیمی را ساپورت کنیم، هم چیزهایی که تو توی توضیحت نوشتی.

const botToken = process.env.BOT_TOKEN || '';
const ownerIdRaw = process.env.OWNER_ID || '';
const supabaseUrl = process.env.SUPABASE_URL || '';

// ترتیب ترجیح:
// 1) SUPABASE_SERVICE_ROLE_KEY  → پیشنهادی برای سرور
// 2) SUPABASE_KEY               → نام جنرال/قدیمی
// 3) SUPABASE_ANON_KEY          → چیزی که تو توی توضیحت نوشتی
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

const renderUrl = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_URL || '';
const port = parseInt(process.env.PORT || '3000', 10);

// این اگر لازم شد بعداً می‌توانیم بر اساسش لاگ و رفتار متفاوت داشته باشیم
const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

const config = {
  botToken,
  ownerId: parseInt(ownerIdRaw || '0', 10),
  supabaseUrl,
  supabaseKey,
  renderUrl,
  port,
  nodeEnv,
  isProd,
};

// اعتبارسنجی پایه‌ای ENV
const missing = [];
if (!config.botToken) missing.push('BOT_TOKEN');
if (!config.ownerId) missing.push('OWNER_ID');
if (!config.supabaseUrl) missing.push('SUPABASE_URL');
if (!config.supabaseKey) {
  missing.push('SUPABASE_SERVICE_ROLE_KEY / SUPABASE_KEY / SUPABASE_ANON_KEY');
}

if (missing.length) {
  console.error('❌ ENV ناقص است. مقادیر زیر تنظیم نشده‌اند:');
  for (const key of missing) {
    console.error('  -', key);
  }
  console.error('\nمثال تنظیم ENV:');
  console.error('  BOT_TOKEN=123:ABC');
  console.error('  OWNER_ID=123456789');
  console.error('  SUPABASE_URL=https://YOUR.supabase.co');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=ey...  (یا SUPABASE_ANON_KEY / SUPABASE_KEY)');
  console.error('  RENDER_EXTERNAL_URL=https://your-service.onrender.com');
  console.error('  PORT=3000');
  process.exit(1);
}

module.exports = { config };
