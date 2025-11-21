--- a/src/infra/supabase.js
+++ b/src/infra/supabase.js
@@ -1,6 +1,12 @@
-const { createClient } = require('@supabase/supabase-js');
-const config = require('../config/index.js'); // اگر قبلاً مسیر اشتباه بوده، همین اصلاح کافی است
+const { createClient } = require('@supabase/supabase-js');
+// ساختار پروژه را حفظ می‌کنیم: infra → .. → config
+// اگر قبلاً از مسیر دیگری ایمپورت می‌کردی ولی فایل همان index.js بود، این مسیر درست است.
+const config = require('../config');
 
-const supa = createClient(config.supabaseUrl, config.supabaseKey);
+// گزینه‌های auth سبک؛ تغییری در رفتار دیتابیس ایجاد نمی‌کند
+const supa = createClient(config.supabaseUrl, config.supabaseKey, {
+  auth: { persistSession: false, autoRefreshToken: true }
+});
 
 module.exports = { supa };
