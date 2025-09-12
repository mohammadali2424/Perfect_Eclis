// services/supabase.js
const { createClient } = require('@supabase/supabase-js');

// ایجاد کلاینت Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// تابع برای ذخیره کاربر جدید
const insertUser = async (chatId, firstName, username) => {
  const { data, error } = await supabase
    .from('users')
    .insert([{ chat_id: chatId, first_name: firstName, username: username }]);

  if (error) {
    console.error('Error inserting user:', error);
    throw error; // خطا را به سطح بالا پرتاب می‌کنیم تا در هندلر اصلی مدیریت شود
  }
  return data;
};

// تابع برای بررسی وضعیت قرنطینه کاربر
const getUserQuarantineStatus = async (userId) => {
  const { data, error } = await supabase
    .from('user_quarantine')
    .select('*')
    .eq('user_id', userId)
    .single(); // فقط یک رکورد برمی‌گرداند

  if (error && error.code !== 'PGRST116') { // PGRST116 به معنای "یافت نشد" است
    console.error('Error fetching user quarantine status:', error);
    throw error;
  }
  return data; // اگر کاربر پیدا نشد، null برمی‌گرداند
};

// سایر توابع مربوط به دیتابیس را می‌توانید اینجا اضافه کنید
// مثلاً توابع مربوط به ذخیره تنظیمات تریگر یا آپدیت وضعیت قرنطینه

module.exports = {
  supabase,
  insertUser,
  getUserQuarantineStatus
};