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

// تابع حذف کاربر از گروه (بدون بن)
async function removeUserFromChat(chatId, userId) {
  try {
    // ابتدا مطمئن شویم ربات ادمین است
    if (!(await isBotAdmin(chatId))) {
      console.error('ربات در گروه ادمین نیست');
      return false;
    }
    
    // حذف کاربر بدون بن کردن
    await bot.telegram.unbanChatMember(chatId, userId);
    return true;
  } catch (error) {
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
    
    if (allChats) {
      for (const chat of allChats) {
        if (chat.chat_id !== currentChatId) {
          try {
            await removeUserFromChat(chat.chat_id, userId);
          } catch (error) {
            console.error(`حذف از گروه ${chat.chat_id} ناموفق بود:`, error);
          }
        }
      }
    }
  } catch (error) {
    console.error('خطا در حذف کاربر از گروه‌های دیگر:', error);
  }
}

// تابع پردازش کاربر جدید (قرنطینه اتوماتیک)
async function handleNewUser(ctx, user) {
  try {
    const now = new Date().toISOString();
    
    // بررسی آیا کاربر در حال حاضر در قرنطینه است
    const { data: existingUser, error: queryError } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_quarantined', true)
      .single();

    if (queryError && queryError.code !== 'PGRST116') {
      console.error('خطا در بررسی کاربر موجود:', queryError);
      return;
    }

    if (existingUser) {
      // کاربر از قبل در قرنطینه است
      if (existingUser.current_chat_id !== ctx.chat.id) {
        // کاربر از گروه فعلی حذف شود
        await removeUserFromChat(ctx.chat.id, user.id);
      }
      
      // کاربر از تمام گروه‌های دیگر حذف شود
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
          
      } else if (!member.is_bot) {
        // کاربر عادی به گروه اضافه شده - قرنطینه اتوماتیک
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
