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

// تابع حذف کاربر از گروه (فقط حذف - بدون بن)
async function removeUserFromChat(chatId, userId) {
  try {
    // فقط کاربر را از گروه حذف می‌کند (بدون بن)
    await bot.telegram.kickChatMember(chatId, userId);
    return true;
  } catch (error) {
    console.error('خطا در حذف کاربر از گروه:', error);
    return false;
  }
}

// تابع پردازش کاربر جدید (قرنطینه اتوماتیک)
async function handleNewUser(ctx, user) {
  try {
    const now = new Date().toISOString();
    
    // بررسی آیا کاربر در حال حاضر در قرنطینه است
    const { data: existingUser } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_quarantined', true)
      .single();

    if (existingUser) {
      // کاربر از قبل در قرنطینه است
      if (existingUser.current_chat_id !== ctx.chat.id) {
        // کاربر از گروه فعلی حذف شود
        await removeUserFromChat(ctx.chat.id, user.id);
      }
      
      // کاربر از تمام گروه‌های دیگر حذف شود
      const { data: allChats } = await supabase
        .from('allowed_chats')
        .select('chat_id');
      
      if (allChats) {
        for (const chat of allChats) {
          if (chat.chat_id !== existingUser.current_chat_id) {
            try {
              await removeUserFromChat(chat.chat_id, user.id);
            } catch (error) {
              console.error(`حذف از گروه ${chat.chat_id} ناموفق بود:`, error);
            }
          }
        }
      }
      
      // به روز رسانی گروه فعلی کاربر
      await supabase
        .from('quarantine_users')
        .update({ 
          current_chat_id: ctx.chat.id,
          updated_at: now
        })
        .eq('user_id', user.id);
        
    } else {
      // کاربر جدید - قرنطینه اتوماتیک
      const { error } = await supabase
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
      
      if (error) {
        console.error('خطا در ذخیره کاربر در قرنطینه:', error);
        return;
      }
      
      // کاربر از تمام گروه‌های دیگر حذف شود
      const { data: allChats } = await supabase
        .from('allowed_chats')
        .select('chat_id');
      
      if (allChats) {
        for (const chat of allChats) {
          if (chat.chat_id !== ctx.chat.id) {
            try {
              await removeUserFromChat(chat.chat_id, user.id);
            } catch (error) {
              console.error(`حذف از گروه ${chat.chat_id} ناموفق بود:`, error);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('خطا در پردازش کاربر جدید:', error);
  }
}

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
          
      } else {
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
  } catch (error) {
    console.error('خطا در دستور فعال:', error);
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
        
      if (error) {
        console.error('خطا در به‌روزرسانی وضعیت کاربر:', error);
      }
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

// وب سرور برای Render
app.use(express.json());
app.use(bot.webhookCallback('/webhook'));

app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// فعال سازی وب هوک (یک بار اجرا شود)
// bot.telegram.setWebhook('https://your-render-url.onrender.com/webhook');
