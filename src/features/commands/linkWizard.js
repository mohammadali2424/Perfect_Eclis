--- a/src/features/commands/linkWizard.js
+++ b/src/features/commands/linkWizard.js
@@ -1,6 +1,7 @@
 const { Markup } = require('telegraf');
 const { supa } = require('../../infra/supabase');
 const { getPages, insertPage } = require('../../domain/repositories/pagesRepo');
+// ساختار فایل حفظ شده؛ فقط محافظ اضافه شده

 const wiz = new Map();

 function state(uid) { return wiz.get(`w:${uid}`) || null; }
@@
-function ensureOwner(ctx, ownerId){
+function ensureOwner(ctx, ownerId){
   return `${ctx.from?.id}` === `${ownerId}`;
 }
 
-function register(bot, config){
-  const OWNER_ID = config.ownerId;
+function register(bot, config = {}){
+  // Fallback به ENV اگر config پاس داده نشده باشد
+  const OWNER_ID = (config && config.ownerId) != null
+    ? config.ownerId
+    : Number(process.env.OWNER_ID || 0);
 
+  // اگر ست نشده بود، بات کرش نکند؛ فقط پیام راهنما بده
+  if (!OWNER_ID) {
+    bot.command('linkwizard', async (ctx) => {
+      return ctx.reply('OWNER_ID تنظیم نشده. در ENV یا config.ownerId مقداردهی کن.');
+    });
+    bot.command('cancel', async (ctx) => ctx.reply('لغو شد.'));
+    return;
+  }
+
   bot.command('linkwizard', async (ctx)=>{
     if (!ensureOwner(ctx, OWNER_ID)) return ctx.reply('فقط مالک.');
     setState(ctx.from.id, { step: 'ask_chat' });
@@
   });
 }
 
 module.exports = { register };
