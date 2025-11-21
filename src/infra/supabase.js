const { createClient } = require('@supabase/supabase-js');
const { config } = require('../config');

const supa = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

module.exports = { supa };
