const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// تنظیمات Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// توکن ربات
const bot = new Telegraf(process.env.BOT_TOKEN);

// آیدی مالک برای ارسال گزارش‌ها
const OWNER_ID = process.env.OWNER_ID;

// کش برای ذخیره گروه‌های مجاز (برای کاهش درخواست به دیتابیس)
let allowedChatsCache = [];
let cacheLastUpdated = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 دقیقه

// ================= توابع کمکی =================

/**
 * دریافت گروه‌های مجاز از کش یا دیتابیس
 */
async function getAllowedChats() {
  const now = Date.now();
  
  // اگر کش معتبر است، از کش استفاده کن
  if (cacheLastUpdated && (now - cacheLastUpdated) < CACHE_DURATION) {
    return allowedChatsCache;
  }
  
  // در غیر این صورت از دیتابیس بگیر و کش را بروز کن
  try {
    const { data, error } = await supabase
      .from('allowed_chats')
      .select('chat_id');
    
    if (error) {
      console.error('خطا در دریافت گروه‌های مجاز:', error);
      return allowedChatsCache; // بازگشت کش قدیمی در صورت خطا
    }
    
    allowedChatsCache = data.map(chat => chat.chat_id);
    cacheLastUpdated = now;
    return allowedChatsCache;
  } catch (error) {
    console.error('خطا در دریافت گروه‌های مجاز:', error);
    return allowedChatsCache; // بازگشت کش قدیمی در صورت خطا
  }
}

/**
 * بررسی آیا کاربر ادمین گروه هست یا نه
 */
async function isChatAdmin(chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return ['administrator', 'creator'].includes(member.status);
  } catch (error) {
    console.error('خطا در بررسی ادمین:', error);
    return false;
  }
}

/**
 * حذف کاربر از گروه (بدون بن کردن) - بهینه‌شده
 */
async function removeUserFromChat(chatId, userId) {
  try {
    // استفاده از kickChatMember با زمان بسیار کوتاه (1 ثانیه)
    await bot.telegram.kickChatMember(chatId, userId, { 
      until_date: Math.floor(Date.now() / 1000) + 1 // فقط 1 ثانیه
    });
    
    console.log(`کاربر ${userId} از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    console.error('خطا در حذف کاربر از گروه:', error);
    return false;
  }
}

/**
 * بررسی آیا کاربر در قرنطینه هست یا نه
 */
async function isUserQuarantined(userId) {
  try {
    const { data, error } = await supabase
      .from('quarantine_users')
      .select('is_quarantined, current_chat_id')
      .eq('user_id', userId)
      .single();

    return data ? { isQuarantined: data.is_quarantined, currentChatId: data.current_chat_id } : { isQuarantined: false, currentChatId: null };
  } catch (error) {
    console.error('خطا در بررسی وضعیت قرنطینه:', error);
    return { isQuarantined: false, currentChatId: null };
  }
}

/**
 * اضافه کردن کاربر به قرنطینه
 */
async function addUserToQuarantine(user, chatId) {
  try {
    const now = new Date().toISOString();
    
    const { error } = await supabase
      .from('quarantine_users')
      .upsert({
        user_id: user.id,
        username: user.username,
        first_name: user.first_name,
        is_quarantined: true,
        current_chat_id: chatId,
        created_at: now,
        updated_at: now
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('خطا در ذخیره کاربر در قرنطینه:', error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('خطا در افزودن کاربر به قرنطینه:', error);
    return false;
  }
}

/**
 * حذف کاربر از قرنطینه
 */
async function removeUserFromQuarantine(userId) {
  try {
    const { error } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) {
      console.error('خطا در به‌روزرسانی وضعیت کاربر:', error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('خطا در حذف کاربر از قرنطینه:', error);
    return false;
  }
}

/**
 * حذف کاربر از تمام گروه‌ها به جز گروه فعلی - بهینه‌شده
 */
async function removeUserFromOtherChats(userId, currentChatId) {
  try {
    // دریافت گروه‌های مجاز از کش
    const allowedChats = await getAllowedChats();
    
    // حذف کاربر از تمام گروه‌ها به جز گروه فعلی
    const removalPromises = allowedChats
      .filter(chatId => chatId !== currentChatId)
      .map(chatId => removeUserFromChat(chatId, userId).catch(error => {
        console.error(`حذف از گروه ${chatId} ناموفق بود:`, error);
        return false;
      }));
    
    // اجرای همزمان حذف کاربران
    await Promise.all(removalPromises);
    
    return true;
  } catch (error) {
    console.error('خطا در حذف کاربر از گروه‌های دیگر:', error);
    return false;
  }
}

/**
 * بررسی کاربرانی که بیش از ۳ روز در یک گروه هستند و حذف آنها از قرنطینه
 */
async function checkLongTermUsers() {
  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    // یافتن کاربرانی که بیش از ۳ روز در قرنطینه هستند
    const { data: longTermUsers, error } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('is_quarantined', true)
      .lt('updated_at', threeDaysAgo.toISOString());

    if (error) {
      console.error('خطا در دریافت کاربران قدیمی:', error);
      return;
    }

    if (!longTermUsers || longTermUsers.length === 0) {
      return;
    }

    let reportMessage = "کاربران حذف شده از قرنطینه پس از ۳ روز:\n";
    for (const user of longTermUsers) {
      // حذف کاربر از قرنطینه
      await removeUserFromQuarantine(user.user_id);

      // افزودن به گزارش
      reportMessage += `کاربر: ${user.first_name} (آیدی: ${user.user_id}) از گروه: ${user.current_chat_id}\n`;
    }

    // ارسال گزارش به مالک
    if (OWNER_ID) {
      try {
        await bot.telegram.sendMessage(OWNER_ID, reportMessage);
      } catch (sendError) {
        console.error('خطا در ارسال گزارش به مالک:', sendError);
      }
    }
  } catch (error) {
    console.error('خطا در بررسی کاربران قدیمی:', error);
  }
}

// زمان‌بندی بررسی روزانه کاربران قدیمی (هر 24 ساعت)
setInterval(() => {
  console.log('بررسی کاربران قدیمی...');
  checkLongTermUsers();
}, 24 * 60 * 60 * 1000); // هر 24 ساعت

// همچنین یک بار در ابتدا اجرا شود
setTimeout(() => {
  checkLongTermUsers();
}, 10000); // 10 ثانیه پس از راه‌اندازی

// ================= مدیریت رویدادها =================

// مدیریت اضافه شدن ربات به گروه
bot.on('new_chat_members', async (ctx) => {
  try {
    const newMembers = ctx.message.new_chat_members;
    
    for (const member of newMembers) {
      if (member.is_bot && member.username === ctx.botInfo.username) {
        // ربات به گروه اضافه شده
        if (!(await isChatAdmin(ctx.chat.id, ctx.message.from.id))) {
          await ctx.leaveChat();
          return;
        }
        
        // ذخیره گروه در دیتابیس و بروزرسانی کش
        const { error } = await supabase
          .from('allowed_chats')
          .upsert({
            chat_id: ctx.chat.id,
            chat_title: ctx.chat.title,
            created_at: new Date().toISOString()
          }, { onConflict: 'chat_id' });
        
        // بروزرسانی کش
        cacheLastUpdated = null;
        await getAllowedChats();
          
        if (!error) {
          await ctx.reply('ربات با موفقیت فعال شد! این گروه اکنون تحت نظارت قرنطینه است.');
        }
      } else {
        // کاربر عادی به گروه اضافه شده
        const quarantineStatus = await isUserQuarantined(member.id);
        
        if (quarantineStatus.isQuarantined) {
          // کاربر در قرنطینه است - حذف از گروه فعلی اگر گروه مجاز نیست
          if (quarantineStatus.currentChatId !== ctx.chat.id) {
            await removeUserFromChat(ctx.chat.id, member.id);
          }
        } else {
          // کاربر جدید - افزودن به قرنطینه
          const added = await addUserToQuarantine(member, ctx.chat.id);
          
          if (added) {
            // حذف از سایر گروه‌ها (به صورت غیرهمزمان)
            removeUserFromOtherChats(member.id, ctx.chat.id).then(() => {
              console.log(`کاربر ${member.id} از سایر گروه‌ها حذف شد`);
            }).catch(error => {
              console.error('خطا در حذف کاربر از سایر گروه‌ها:', error);
            });
            
            // ارسال پیام خوشامدگویی و راهنما
            try {
              await ctx.reply(
                `کاربر ${member.first_name} به گروه خوش آمدید!\n` +
                'شما در حال حاضر در حالت قرنطینه قرار دارید.\n' +
                'برای خروج از قرنطینه و آزاد شدن در تمام گروه‌ها از دستور #خروج استفاده کنید.',
                { reply_to_message_id: ctx.message.message_id }
              );
            } catch (messageError) {
              console.error('خطا در ارسال پیام خوشامدگویی:', messageError);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('خطا در پردازش عضو جدید:', error);
  }
});

// دستور #فعال برای ثبت گروه
bot.hears('#فعال', async (ctx) => {
  try {
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) {
      await ctx.reply('فقط ادمین‌ها می‌توانند این دستور را استفاده کنند.');
      return;
    }
    
    const { error } = await supabase
      .from('allowed_chats')
      .upsert({
        chat_id: ctx.chat.id,
        chat_title: ctx.chat.title,
        created_at: new Date().toISOString()
      }, { onConflict: 'chat_id' });
    
    // بروزرسانی کش
    cacheLastUpdated = null;
    await getAllowedChats();
    
    if (error) {
      await ctx.reply('خطا در فعال کردن ربات در این گروه.');
      console.error('خطا در دستور فعال:', error);
    } else {
      await ctx.reply('ربات با موفقیت در این گروه فعال شد.');
    }
  } catch (error) {
    console.error('خطا در دستور فعال:', error);
  }
});

// دستور #خروج برای خروج از قرنطینه
bot.hears('#خروج', async (ctx) => {
  try {
    const removed = await removeUserFromQuarantine(ctx.from.id);
    
    if (removed) {
      await ctx.reply('شما از قرنطینه خارج شدید. اکنون می‌توانید به تمام گروه‌ها ملحق شوید.');
    } else {
      await ctx.reply('خطایی در خروج از قرنطینه رخ داده است.');
    }
  } catch (error) {
    console.error('خطا در پردازش دستور خروج:', error);
  }
});

// دستور #حذف برای ادمین‌ها (ریپلای روی کاربر)
bot.hears('#حذف', async (ctx) => {
  try {
    if (!ctx.message.reply_to_message) {
      await ctx.reply('لطفاً روی پیام کاربر مورد نظر ریپلای کنید.');
      return;
    }
    
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) {
      await ctx.reply('فقط ادمین‌ها می‌توانند این دستور را استفاده کنند.');
      return;
    }
    
    const targetUser = ctx.message.reply_to_message.from;
    const removed = await removeUserFromQuarantine(targetUser.id);
    
    if (removed) {
      await ctx.reply(`کاربر ${targetUser.first_name} از قرنطینه خارج شد.`);
    } else {
      await ctx.reply('خطایی در حذف کاربر از قرنطینه رخ داده است.');
    }
  } catch (error) {
    console.error('خطا در پردازش دستور حذف:', error);
  }
});

// دستور #وضعیت برای بررسی وضعیت کاربر
bot.hears('#وضعیت', async (ctx) => {
  try {
    const quarantineStatus = await isUserQuarantined(ctx.from.id);
    
    if (quarantineStatus.isQuarantined) {
      await ctx.reply('شما در حال حاضر در قرنطینه هستید.');
    } else {
      await ctx.reply('شما در قرنطینه نیستید و می‌توانید آزادانه به گروه‌ها ملحق شوید.');
    }
  } catch (error) {
    console.error('خطا در پردازش دستور وضعیت:', error);
  }
});

// وب سرور برای Render
app.use(express.json());
app.use(bot.webhookCallback('/webhook'));

app.get('/', (req, res) => {
  res.send('ربات قرنطینه فعال است!');
});

app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res);
});

app.listen(PORT, () => {
  console.log(`سرور در پورت ${PORT} در حال اجراست...`);
});

// فعال سازی وب هوک (یک بار اجرا شود)
// bot.telegram.setWebhook('https://your-render-url.onrender.com/webhook');
