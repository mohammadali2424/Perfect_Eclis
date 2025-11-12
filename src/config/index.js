const config = {
  botToken: process.env.BOT_TOKEN,
  ownerId: parseInt(process.env.OWNER_ID || '0', 10),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
  renderUrl: process.env.RENDER_EXTERNAL_URL || '',
  port: parseInt(process.env.PORT || '3000', 10)
};

if (!config.botToken || !config.ownerId || !config.supabaseUrl || !config.supabaseKey) {
  console.error('❌ ENV ناقص: BOT_TOKEN, OWNER_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

module.exports = { config };
