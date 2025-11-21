// src/infra/supabase.js
const { createClient } = require('@supabase/supabase-js');
const config = require('../config'); // مسیر درست نسبت به این فایل (infra → .. → config)

const supa = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
  },
  // می‌تونی fetch سفارشی هم بدهی اگر لازم شد
});

module.exports = { supa };
