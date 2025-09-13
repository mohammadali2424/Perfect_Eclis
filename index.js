const { Telegraf, Scenes, session } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// بررسی وجود متغیرهای محیطی
const requiredEnvVars = ['BOT_TOKEN', 'SUPABASE_URL', 'SUPABASE_KEY'];
requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    console.error(`❌ ERROR: ${envVar} is not set!`);
    process.exit(1);
  }
});

// مقداردهی Supabase و Telegraf
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Telegraf(process.env.BOT_TOKEN);

// کش برای مدیریت کاربران قرنطینه (حافظه موقت برای دسترسی سریع)
const quarantineCache = {
  users: new Map(), // کاربران در قرنطینه: userId -> { timestamp, ... }
  releasedUsers: new Map(), // کاربران آزاد شده: userId -> { timestamp, ... }
  
  // 📥 تابع برای لود اولیه داده‌ها از دیتابیس به کش
  loadFromDatabase: async function() {
    try {
      console.log('🔄 در حال بارگذاری داده‌های قرنطینه از دیتابیس...');
      
      // دریافت کاربرانی که در حال حاضر قرنطینه هستند
      const { data: quarantinedUsers, error: quarantineError } = await supabase
        .from('user_quarantine')
        .select('user_id, quarantined_at')
        .eq('is_quarantined', true);
      
      if (quarantineError) throw quarantineError;
      
      // دریافت کاربرانی که اخیراً آزاد شده‌اند (برای جلوگیری از قرنطینه مجدد)
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: releasedUsers, error: releasedError } = await supabase
        .from('user_quarantine')
        .select('user_id, released_at')
        .eq('is_quarantined', false)
        .gt('released_at', twentyFourHoursAgo); // فقط کاربران آزاد شده در 24 ساعت گذشته
      
      if (releasedError) throw releasedError;
      
      // پر کردن کش با داده‌های دیتابیس
      this.users.clear();
      this.releasedUsers.clear();
      
      quarantinedUsers.forEach(user => {
        this.users.set(user.user_id, { 
          timestamp: new Date(user.quarantined_at).getTime() 
        });
      });
      
      releasedUsers.forEach(user => {
        this.releasedUsers.set(user.user_id, { 
          timestamp: new Date(user.released_at).getTime() 
        });
      });
      
      console.log(`✅ داده‌های قرنطینه لود شدند: ${this.users.size} کاربر قرنطینه، ${this.releasedUsers.size} کاربر آزاد شده در 24 ساعت گذشته.`);
    } catch (error) {
      console.error('❌ خطا در لود داده‌های قرنطینه از دیتابیس:', error);
    }
  },
  
  // ➕ اضافه کردن کاربر به قرنطینه (هم در کش و هم در دیتابیس)
  addUser: async function(userId) {
    const now = Date.now();
    this.users.set(userId, { timestamp: now });
    this.releasedUsers.delete(userId);
    
    try {
      const { error } = await supabase
        .from('user_quarantine')
        .upsert({
          user_id: userId,
          is_quarantined: true,
          quarantined_at: new Date(now).toISOString(),
          released_at: null
        });
      
      if (error) throw error;
      console.log(`✅ کاربر ${userId} به قرنطینه اضافه شد (ذخیره در دیتابیس).`);
    } catch (error) {
      console.error(`❌ خطا در ذخیره کاربر ${userId} در دیتابیس:`, error);
    }
  },
  
  // 🆓 آزاد کردن کاربر از قرنطینه (هم در کش و هم در دیتابیس)
  releaseUser: async function(userId) {
    if (!this.users.has(userId)) return; // اگر کاربر اصلاً در قرنطینه نبود، کاری نکن
    
    const now = Date.now();
    this.users.delete(userId);
    this.releasedUsers.set(userId, { timestamp: now });
    
    try {
      const { error } = await supabase
        .from('user_quarantine')
        .upsert({
          user_id: userId,
          is_quarantined: false,
          released_at: new Date(now).toISOString()
        });
      
      if (error) throw error;
      console.log(`✅ کاربر ${userId} از قرنطینه آزاد شد (ذخیره در دیتابیس).`);
    } catch (error) {
      console.error(`❌ خطا در آزاد کردن کاربر ${userId} در دیتابیس:`, error);
    }
  },
  
  // 🔍 بررسی آیا کاربر در قرنطینه است
  isUserQuarantined: function(userId) {
    return this.users.has(userId) && !this.releasedUsers.has(userId);
  },
  
  // 🧹 پاکسازی خودکار کاربران آزاد شده قدیمی از کش (هر 24 ساعت)
  cleanup: function() {
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    
    // پاکسازی کاربران آزاد شده قدیمی از کش
    for (const [userId, data] of this.releasedUsers.entries()) {
      if (now - data.timestamp > twentyFourHours) {
        this.releasedUsers.delete(userId);
        console.log(`🧹 کاربر ${userId} از کش آزاد شده‌ها پاک شد.`);
      }
    }
  }
};

// 🔄 لود داده‌ها از دیتابیس به محض راه‌اندازی ربات
quarantineCache.loadFromDatabase();

// پاکسازی خودکار هر 24 ساعت
setInterval(() => {
  quarantineCache.cleanup();
}, 24 * 60 * 60 * 1000);

// 🔥 هندلر اصلی: حذف کاربران قرنطینه از گروه‌ها
bot.on('chat_member', async (ctx) => {
  try {
    const newMember = ctx.update.chat_member.new_chat_member;
    const userId = newMember.user.id;
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    
    if ((chatType === 'group' || chatType === 'supergroup') && 
        (newMember.status === 'member' || newMember.status === 'administrator')) {
      
      // بررسی آیا کاربر در قرنطینه است
      if (quarantineCache.isUserQuarantined(userId)) {
        try {
          const chatMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
          const canRestrict = chatMember.status === 'administrator' && chatMember.can_restrict_members;
          
          if (canRestrict) {
            await ctx.telegram.kickChatMember(chatId, userId);
            console.log(`🚫 کاربر ${userId} از گروه ${chatId} حذف شد (قرنطینه فعال).`);
          } else {
            console.log(`⚠️ ربات در گروه ${chatId} ادمین نیست یا حق حذف کاربران را ندارد.`);
          }
        } catch (error) {
          console.error(`❌ خطا در حذف کاربر ${userId} از گروه ${chatId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error in chat_member handler:', error);
  }
});

// 🔥 کاربر به محض ورود به هر گروهی، به طور خودکار در قرنطینه قرار می‌گیرد
bot.on('chat_member', async (ctx) => {
  try {
    const newMember = ctx.update.chat_member.new_chat_member;
    const userId = newMember.user.id;
    const chatType = ctx.chat.type;
    
    if ((chatType === 'group' || chatType === 'supergroup') && 
        newMember.status === 'member' &&
        !quarantineCache.isUserQuarantined(userId) &&
        !quarantineCache.releasedUsers.has(userId)) {
      
      // کاربر را به قرنطینه اضافه کن
      await quarantineCache.addUser(userId);
      console.log(`✅ کاربر ${userId} به طور خودکار به قرنطینه اضافه شد.`);
    }
  } catch (error) {
    console.error('Error in auto-quarantine handler:', error);
  }
});

// 🔥 تشخیص #خروج در هر جای متن - خروج از قرنطینه
bot.hears(/.*#خروج.*/, async (ctx) => {
  try {
    const userId = ctx.from.id;

    // آزاد کردن کاربر از قرنطینه
    await quarantineCache.releaseUser(userId);
    
    await ctx.reply('✅ شما از قرنطینه خارج شدید و از این پس می‌توانید آزادانه به گروه‌ها وارد شوید.');
    
  } catch (error) {
    console.error('Error in #خروج command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// ... (بقیه کدها مانند سناریوهای Wizard و دستورات دیگر بدون تغییر میمونن)

// راه‌اندازی سرور
app.listen(PORT, async () => {
  console.log(`🤖 ربات در پورت ${PORT} راه‌اندازی شد...`);
});
