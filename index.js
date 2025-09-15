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

// سیستم پاک‌سازی کاربران قدیمی (فقط کاربران غیرقرنطینه)
async function cleanupOldUsers() {
  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    // پاک‌سازی کاربرانی که 3 روز از آخرین فعالیتشان گذشته و در قرنطینه نیستند
    const { error } = await supabase
      .from('users')
      .delete()
      .lt('updated_at', threeDaysAgo.toISOString())
      .eq('in_quarantine', false);
    
    if (error) {
      console.error('خطا در پاک‌سازی کاربران قدیمی:', error);
    } else {
      console.log('پاک‌سازی کاربران قدیمی انجام شد');
    }
  } catch (error) {
    console.error('خطا در پاک‌سازی:', error);
  }
}

// اجرای پاک‌سازی هر 24 ساعت
setInterval(cleanupOldUsers, 24 * 60 * 60 * 1000);
cleanupOldUsers(); // اجرای اولیه

// تابع بررسی ادمین بودن
async function isChatAdmin(chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return ['administrator', 'creator'].includes(member.status);
  } catch (error) {
    console.error(error);
    return false;
  }
}

// تابع حذف کاربر از گروه (فقط remove - بدون بن)
async function removeUserFromChat(chatId, userId) {
  try {
    // فقط کاربر را از گروه اخراج می‌کند (بدون بن)
    await bot.telegram.kickChatMember(chatId, userId);
    return true;
  } catch (error) {
    console.error('خطا در حذف کاربر از گروه:', error);
    return false;
  }
}

// تابع پردازش کاربر جدید (قرنطینه اتوم��تیک)
async function handleNewUser(ctx, user) {
  try {
    // بررسی آیا کاربر در قرنطینه است
    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', user.id)
      .single();
    
    const now = new Date().toISOString();
    
    if (userData?.in_quarantine) {
      // کاربر در حال حاضر در قرنطینه است
      if (userData.current_chat !== ctx.chat.id) {
        // کاربر از گروه فعلی حذف شود
        await removeUserFromChat(ctx.chat.id, user.id);
      }
      
      // کاربر از تمام گروه‌های دیگر حذف شود
      const { data: allChats } = await supabase
        .from('allowed_chats')
        .select('chat_id');
      
      if (allChats) {
        for (const chat of allChats) {
          if (chat.chat_id !== userData.current_chat) {
            try {
              await removeUserFromChat(chat.chat_id, user.id);
            } catch (error) {
              console.error(`حذف از گروه ${chat.chat_id} ناموفق بود:`, error);
            }
          }
        }
      }
      
    } else {
      // کاربر جدید - قرنطینه اتوماتیک
      const { error } = await supabase
        .from('users')
        .upsert({
          user_id: user.id,
          username: user.username,
          first_name: user.first_name,
          in_quarantine: true,
          current_chat: ctx.chat.id,
          created_at: now,
          updated_at: now
        }, { onConflict: 'user_id' });
      
      if (error) {
        console.error('خطا در ذخیره کاربر:', error);
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

// دستور start فقط برای مالکین
bot.start(async (ctx) => {
  const { data: isOwner } = await supabase
    .from('allowed_owners')
    .select('*')
    .eq('owner_id', ctx.from.id)
    .single();

  if (!isOwner) return;
});

// مدیریت اضافه شدن ربات به گروه
bot.on('new_chat_members', async (ctx) => {
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
        
      if (error) console.error(error);
      
    } else {
      // کاربر عادی به گروه اضافه شده - قرنطینه اتوماتیک
      await handleNewUser(ctx, member);
    }
  }
});

// دستور #فعال برای ثبت گروه
bot.hears('#فعال', async (ctx) => {
  if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) return;
  
  const { error } = await supabase
    .from('allowed_chats')
    .upsert({
      chat_id: ctx.chat.id,
      chat_title: ctx.chat.title,
      created_at: new Date().toISOString()
    }, { onConflict: 'chat_id' });
    
  if (error) console.error(error);
});

// دستور #خروج برای خروج از قرنطینه (در هر متنی که باشد)
bot.on('text', async (ctx) => {
  const messageText = ctx.message.text;
  
  if (messageText.includes('#خروج')) {
    const { error } = await supabase
      .from('users')
      .update({ 
        in_quarantine: false,
        current_chat: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', ctx.from.id);
      
    if (error) {
      console.error('خطا در به‌روزرسانی وضعیت کاربر:', error);
    }
  }
});

// دستور #حذف برای ادمین‌ها (ریپلای روی کاربر)
bot.on('message', async (ctx) => {
  const messageText = ctx.message.text;
  
  if (messageText.includes('#حذف') && ctx.message.reply_to_message) {
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) return;
    
    const targetUser = ctx.message.reply_to_message.from;
    
    const { error } = await supabase
      .from('users')
      .update({ 
        in_quarantine: false,
        current_chat: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', targetUser.id);
    
    if (error) console.error(error);
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

// فعال سازی وب هوک
// bot.telegram.setWebhook('https://your-render-url.onrender.com/webhook');
