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

// تابع بررسی ادمین بودن
async function isChatAdmin(chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return ['administrator', 'creator'].includes(member.status);
  } catch (error) {
    console.error('خطا در بررسی ادمین:', error);
    return false;
  }
}

// تابع بررسی مالک بودن
async function isOwner(userId) {
  try {
    const { data, error } = await supabase
      .from('allowed_owners')
      .select('owner_id')
      .eq('owner_id', userId)
      .single();
    
    return data !== null;
  } catch (error) {
    console.error('خطا در بررسی مالک:', error);
    return false;
  }
}

// تابع بررسی اینکه آیا ربات ادمین است
async function isBotAdmin(chatId) {
  try {
    const self = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    return ['administrator', 'creator'].includes(self.status);
  } catch (error) {
    console.error('خطا در بررسی ادمین بودن ربات:', error);
    return false;
  }
}

// تابع بررسی وضعیت کاربر در گروه
async function getUserStatus(chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return member.status;
  } catch (error) {
    // اگر کاربر در گروه نیست یا خطای دیگری رخ داد
    if (error.response && error.response.error_code === 400) {
      return 'not_member';
    }
    console.error('خطا در بررسی وضعیت کاربر:', error);
    return null;
  }
}

// تابع حذف کاربر از گروه (بدون بن)
async function removeUserFromChat(chatId, userId) {
  try {
    // ابتدا مطمئن شویم ربات ادمین است
    if (!(await isBotAdmin(chatId))) {
      console.error('ربات در گروه ادمین نیست');
      return false;
    }
    
    // بررسی وضعیت کاربر در گروه
    const userStatus = await getUserStatus(chatId, userId);
    
    // اگر کاربر در گروه نیست یا قبلاً حذف شده
    if (userStatus === 'not_member' || userStatus === 'left' || userStatus === 'kicked') {
      console.log(`کاربر ${userId} از قبل در گروه ${chatId} نیست`);
      return true;
    }
    
    // اگر کاربر مالک گروه است، نمی‌توانیم حذفش کنیم
    if (userStatus === 'creator') {
      console.warn(`کاربر ${userId} مالک گروه است و نمی‌توان حذف کرد`);
      return false;
    }
    
    // حذف کاربر بدون بن کردن
    await bot.telegram.unbanChatMember(chatId, userId);
    console.log(`کاربر ${userId} از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    // اگر خطا مربوط به مالک گروه بودن کاربر است، آن را نادیده بگیر
    if (error.response && error.response.description && error.response.description.includes("can't remove chat owner")) {
      console.warn(`کاربر ${userId} مالک گروه است و نمی‌توان حذف کرد`);
      return false;
    }
    
    // اگر خطا مربوط به عدم وجود کاربر در گروه است
    if (error.response && error.response.error_code === 400 && error.response.description.includes("user not found")) {
      console.log(`کاربر ${userId} در گروه ${chatId} پیدا نشد`);
      return true;
    }
    
    console.error('خطا در حذف کاربر از گروه:', error);
    return false;
  }
}

// تابع بررسی و حذف کاربر از تمام گروه‌های دیگر
async function removeUserFromAllOtherChats(currentChatId, userId) {
  try {
    // دریافت تمام گروه‌های مجاز
    const { data: allChats, error: chatsError } = await supabase
      .from('allowed_chats')
      .select('chat_id');
    
    if (chatsError) {
      console.error('خطا در دریافت گروه‌ها:', chatsError);
      return;
    }
    
    if (allChats && allChats.length > 0) {
      console.log(`حذف کاربر ${userId} از ${allChats.length} گروه به جز ${currentChatId}`);
      
      for (const chat of allChats) {
        if (chat.chat_id.toString() !== currentChatId.toString()) {
          try {
            console.log(`تلاش برای حذف کاربر از گروه ${chat.chat_id}`);
            await removeUserFromChat(chat.chat_id, userId);
          } catch (error) {
            console.error(`حذف از گروه ${chat.chat_id} ناموفق بود:`, error);
          }
        }
      }
    } else {
      console.log('هیچ گروهی در دیتابیس ثبت نشده است');
    }
  } catch (error) {
    console.error('خطا در حذف کاربر از گروه‌های دیگر:', error);
  }
}

// تابع پردازش کاربر جدید (قرنطینه اتوماتیک)
async function handleNewUser(ctx, user) {
  try {
    const now = new Date().toISOString();
    console.log(`پردازش کاربر جدید: ${user.id} در گروه ${ctx.chat.id}`);
    
    // بررسی آیا کاربر در حال حاضر در قرنطینه است
    const { data: existingUser, error: queryError } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_quarantined', true)
      .single();

    if (queryError && queryError.code !== 'PGRST116') {
      console.error('خطا در بررسی کارب�� موجود:', queryError);
      return;
    }

    if (existingUser) {
      console.log(`کاربر ${user.id} از قبل در قرنطینه است`);
      
      // کاربر از قبل در قرنطینه است
      if (existingUser.current_chat_id !== ctx.chat.id) {
        // کاربر از گروه فعلی حذف شود
        console.log(`حذف کاربر از گروه فعلی ${ctx.chat.id}`);
        await removeUserFromChat(ctx.chat.id, user.id);
      }
      
      // کاربر از تمام گروه‌های دیگر حذف شود
      console.log(`حذف کاربر از سایر گروه‌ها به جز ${existingUser.current_chat_id}`);
      await removeUserFromAllOtherChats(existingUser.current_chat_id, user.id);
      
      // به روز رسانی گروه فعلی کاربر
      const { error: updateError } = await supabase
        .from('quarantine_users')
        .update({ 
          current_chat_id: ctx.chat.id,
          updated_at: now
        })
        .eq('user_id', user.id);
        
      if (updateError) {
        console.error('خطا در به روز رسانی کاربر:', updateError);
      }
        
    } else {
      // کاربر جدید - قرنطینه اتوماتیک
      console.log(`کاربر ${user.id} جدید است، افزودن ��ه قرنطینه`);
      
      const { error: insertError } = await supabase
        .from('quarantine_users')
        .upsert({
          user_id: user.id,
          username: user.username,
          first_name: user.first_name,
          is_quarantined: true,
          current_chat_id: ctx.chat.id,
          created_at: now,
          updated_at: now
        }, { onConflict: 'user_id' });
      
      if (insertError) {
        console.error('خطا در ذخیره کاربر در قرنطینه:', insertError);
        return;
      }
      
      // کاربر از تمام گروه‌های دیگر حذف شود
      console.log(`حذف کاربر ${user.id} از سایر گروه‌ها به جز ${ctx.chat.id}`);
      await removeUserFromAllOtherChats(ctx.chat.id, user.id);
    }
  } catch (error) {
    console.error('خطا در پردازش کاربر جدید:', error);
  }
}

// دستور /start
bot.start((ctx) => {
  ctx.reply('ناظر اکلیس در خدمت شماست 🥷🏻');
});

// مدیریت اضافه شدن ربات به گروه
bot.on('new_chat_members', async (ctx) => {
  try {
    const newMembers = ctx.message.new_chat_members;
    console.log(`اعضای جدید در گروه ${ctx.chat.id}: ${newMembers.length} نفر`);
    
    for (const member of newMembers) {
      if (member.is_bot && member.username === ctx.botInfo.username) {
        // ربات به گروه اضافه شده
        console.log(`ربات به گروه ${ctx.chat.id} اضافه شد`);
        
        if (!(await isChatAdmin(ctx.chat.id, ctx.message.from.id))) {
          console.log(`کاربر ${ctx.message.from.id} ادمین نیست، ربات گروه را ترک می‌کند`);
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
          
        console.log(`گروه ${ctx.chat.id} در دیتابیس ثبت شد`);
          
      } else if (!member.is_bot) {
        // کاربر عادی به گروه اضافه شده - قرنطینه اتوماتیک
        console.log(`کاربر عادی ${member.id} به گروه اضافه شد`);
        await handleNewUser(ctx, member);
      }
    }
  } catch (error) {
    console.error('خطا در پردازش عضو جدید:', error);
  }
});

// دستور #فعال برای ثبت گروه
bot.hears('#فعال', async (ctx) => {
  try {
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) return;
    
    const { error } = await supabase
      .from('allowed_chats')
      .upsert({
        chat_id: ctx.chat.id,
        chat_title: ctx.chat.title,
        created_at: new Date().toISOString()
      }, { onConflict: 'chat_id' });
    
    ctx.reply('منطقه فعال شد ✅');
  } catch (error) {
    console.error('خطا در دستور فعال:', error);
  }
});

// دستور #غیرفعال برای حذف گروه
bot.hears('#غیرفعال', async (ctx) => {
  try {
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) return;
    
    const { error } = await supabase
      .from('allowed_chats')
      .delete()
      .eq('chat_id', ctx.chat.id);
    
    ctx.reply('منطقه غیرفعال شد ❌');
  } catch (error) {
    console.error('خطا در دستور غیرفعال:', error);
  }
});

// دستور #خروج برای خروج از قرنطینه
bot.on('text', async (ctx) => {
  try {
    const messageText = ctx.message.text;
    
    if (messageText && messageText.includes('#خروج')) {
      const { error } = await supabase
        .from('quarantine_users')
        .update({ 
          is_quarantined: false,
          current_chat_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', ctx.from.id);
    }
  } catch (error) {
    console.error('خطا در پردازش دستور خروج:', error);
  }
});

// دستور #حذف برای ادمین‌ها (ریپلای روی کاربر)
bot.on('message', async (ctx) => {
  try {
    const messageText = ctx.message.text;
    
    if (messageText && messageText.includes('#حذف') && ctx.message.reply_to_message) {
      if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) return;
      
      const targetUser = ctx.message.reply_to_message.from;
      
      const { error } = await supabase
        .from('quarantine_users')
        .update({ 
          is_quarantined: false,
          current_chat_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', targetUser.id);
    }
  } catch (error) {
    console.error('خطا در پردازش دستور حذف:', error);
  }
});

// دستور #حذف برای مالک‌ها (با آیدی کاربر)
bot.on('text', async (ctx) => {
  try {
    const messageText = ctx.message.text;
    
    // بررسی آیا پیام با #حذف شروع می‌شود و بعد از آن یک عدد (آیدی) وجود دارد
    const match = messageText.match(/^#حذف\s+(\d+)$/);
    
    if (match && (await isOwner(ctx.from.id))) {
      const targetUserId = match[1];
      
      const { error } = await supabase
        .from('quarantine_users')
        .update({ 
          is_quarantined: false,
          current_chat_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', targetUserId);
    }
  } catch (error) {
    console.error('خطا در پردازش دستور حذف با آیدی:', error);
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
  console.log(`Server running on port ${PORT}`);
});

// فعال سازی وب هوک (یک بار اجرا شود)
// bot.telegram.setWebhook('https://your-render-url.onrender.com/webhook');
