--- a/src/config/index.js
+++ b/src/config/index.js
@@ -1,7 +1,35 @@
 require('dotenv').config();
 
-const cfg = {
-  botToken: process.env.BOT_TOKEN,
-  ownerId: Number(process.env.OWNER_ID || 0),
-  renderUrl: process.env.RENDER_EXTERNAL_URL,
-  port: Number(process.env.PORT || 3000),
-};
+// ⚠️ ساختار کلی فایل حفظ می‌شود؛ فقط supabase اضافه می‌شود
+function toNum(v, d = 0) {
+  const n = Number(v);
+  return Number.isFinite(n) ? n : d;
+}
+
+const cfg = {
+  botToken: process.env.BOT_TOKEN,
+  ownerId: toNum(process.env.OWNER_ID || 0),
+  renderUrl: process.env.RENDER_EXTERNAL_URL || '',
+  port: toNum(process.env.PORT || 3000),
+
+  // --- اضافه‌شده: تنظیمات Supabase ---
+  supabaseUrl: process.env.SUPABASE_URL || '',
+  // یکی از این دو را ست کن؛ اولویت با Service Role
+  supabaseKey:
+    process.env.SUPABASE_SERVICE_ROLE_KEY ||
+    process.env.SUPABASE_ANON_KEY ||
+    '',
+};
+
+// چک‌های نرم (بدون تغییر در اگزیت/رفتار قبلی مگر لازم باشد)
+if (!cfg.botToken) {
+  console.error('❌ BOT_TOKEN خالی است.');
+  process.exit(1);
+}
+if (!cfg.supabaseUrl) {
+  console.error('❌ SUPABASE_URL خالی است.');
+  process.exit(1);
+}
+if (!cfg.supabaseKey) {
+  console.error('❌ SUPABASE key خالی است (SERVICE_ROLE یا ANON).');
+  process.exit(1);
+}
 
 module.exports = cfg;
