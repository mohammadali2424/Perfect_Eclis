const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const cron = require('node-cron');

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

// ================= توابع کمکی =================

/**
 * بررسی آیا کاربر ادمین گروه هست یا نه
 * @param {number} chatId - آیدی گروه
 * @param {number} userId - آیدی کاربر
 * @returns {boolean} - true اگر ادمین باشد
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
 * حذف کاربر از گروه (بدون بن کردن)
 * @param {number} chatId - آیدی گروه
 * @param {number} userId - آیدی کاربر
 * @returns {boolean} - true اگر موفقیت‌آمیز باشد
 */
async function removeUserFromChat(chatId, userId) {
  try {
    // ابتدا کاربر را از گروه حذف می‌کنیم
    await bot.telegram.kickChatMember(chatId, userId);
    
    // سپس کاربر را آنبن می‌کنیم تا بتواند در آینده再加入 شود
    setTimeout(async () => {
      try {
        await bot.telegram.unbanChatMember(chatId, userId);
      } catch (unbanError) {
        console.error('خطا در آنبن کردن کاربر:', unbanError);
      }
    }, 1000);
    
    return true;
  } catch (error) {
    console.error('خطا در حذف کاربر از گروه:', error);
    return false;
  }
}

/**
 * بررسی آیا کاربر در قرنطینه هست یا نه
 * @param {number} userId - آیدی کاربر
 * @returns {boolean} - true اگر در قرنطینه باشد
 */
async function isUserQuarantined(userId) {
  try {
    const { data, error } = await supabase
      .from('quarantine_users')
      .select('is_quarantined')
      .eq('user_id', userId)
      .single();

    return data ? data.is_quarantined : false;
  } catch (error) {
    console.error('خطا در بررسی وضعیت قرنطینه:', error);
    return false;
  }
}

/**
 * دریافت اطلاعات کاربر از جدول قرنطینه
 * @param {number} userId - آیدی کاربر
 * @returns {Object} - اطلاعات کاربر
 */
async function getQuarantineUser(userId) {
  try {
    const { data, error } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', userId)
      .single();

    return data;
  } catch (error) {
    console.error('خطا در دریافت اطلاعات کاربر:', error);
    return null;
  }
}

/**
 * اضافه کردن کاربر به قرنطینه
 * @param {Object} user - اطلاعات کاربر
 * @param {number} chatId - آیدی گروه فعلی
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
    }
  } catch (error) {
    console.error('خطا در افزودن کاربر به قرنطینه:', error);
  }
}

/**
 * حذف کاربر از قرنطینه
 * @param {number} userId - آیدی کاربر
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
    }
  } catch (error) {
    console.error('خطا در حذف کاربر از قرنطینه:', error);
  }
}

/**
 * حذف کاربر از تمام گروه‌ها به جز گروه فعلی
 * @param {number} userId - آیدی کاربر
 * @param {number} currentChatId - آیدی گروه فعلی
 */
async function removeUserFromOtherChats(userId, currentChatId) {
  try {
    // دریافت تمام گروه‌های مجاز
    const { data: allChats, error } = await supabase
      .from('allowed_chats')
      .select('chat_id');

    if (error) {
      console.error('خطا در دریافت گروه‌های مجاز:', error);
      return;
    }

    // حذف کاربر از تمام گروه‌ها به جز گروه فعلی
    for (const chat of allChats) {
      if (chat.chat_id !== currentChatId) {
        try {
          await removeUserFromChat(chat.chat_id, userId);
        } catch (error) {
          console.error(`حذف از گروه ${chat.chat_id} ناموفق بود:`, error);
        }
      }
    }
  } catch (error) {
    console.error('خطا در حذف کاربر از گروه‌های دیگر:', error);
  }
}

/**
 * بررسی کاربرانی که بیش از ۳ روز در یک گروه هستند و حذف آنها از قرنطینه
 * همچنین ارسال گزارش به مالک
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

    if (longTermUsers.length === 0) {
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

// زمان‌بندی بر��سی روزانه کاربران قدیمی
cron.schedule('0 0 * * *', () => {
  console.log('بررسی کاربران قدیمی...');
  checkLongTermUsers();
});

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
        
        // ذخیره گروه در دیتابیس
        const { error } = await supabase
          .from('allowed_chats')
          .upsert({
            chat_id: ctx.chat.id,
            chat_title: ctx.chat.title,
            created_at: new Date().toISOString()
          }, { onConflict: 'chat_id' });
          
        if (!error) {
          await ctx.reply('ربات با موفقیت فعال شد! این گروه اکنون تحت نظارت قرنطینه است.');
        }
      } else {
        // کاربر عادی به گروه اضافه شده
        const isQuarantined = await isUserQuarantined(member.id);
        
        if (isQuarantined) {
          // کاربر در قرنطینه است - حذف از گروه فعلی اگر گروه مجاز نیست
          const userData = await getQuarantineUser(member.id);
          
          if (userData && userData.current_chat_id !== ctx.chat.id) {
            await removeUserFromChat(ctx.chat.id, member.id);
          }
        } else {
          // کاربر جدید - افزودن به قرنطینه
          await addUserToQuarantine(member, ctx.chat.id);
          await removeUserFromOtherChats(member.id, ctx.chat.id);
          
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
    await removeUserFromQuarantine(ctx.from.id);
    await ctx.reply('شما از قرنطینه خارج شدید. اکنون می‌توانید به تمام گروه‌ها ملحق شوید.');
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
    await removeUserFromQuarantine(targetUser.id);
    await ctx.reply(`کاربر ${targetUser.first_name} از قرنطینه خارج شد.`);
  } catch (error) {
    console.error('خطا در پردازش دستور حذف:', error);
  }
});

// دستور #وضعیت برای بررسی وضعیت کاربر
bot.hears('#وضعیت', async (ctx) => {
  try {
    const isQuarantined = await isUserQuarantined(ctx.from.id);
    
    if (isQuarantined) {
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
