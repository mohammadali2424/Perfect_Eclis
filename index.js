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

// middleware برای تشخیص کاربر
bot.use(async (ctx, next) => {
  if (ctx.from) {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', ctx.from.id)
      .single();
    ctx.userData = user || null;
  }
  return next();
});

// تابع کمکی برای حذف کاربر از گروه (بدون بن)
async function removeUserFromChat(chatId, userId) {
  try {
    // فقط کاربر را از گروه حذف می‌کند (بدون بن کردن)
    await bot.telegram.unbanChatMember(chatId, userId);
    return true;
  } catch (error) {
    console.error('خطا در حذف کاربر:', error);
    return false;
  }
}

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

// تابع پردازش کاربر جدید
async function handleNewUser(ctx, user) {
  const { data: userData } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', user.id)
    .single();
    
  if (userData?.in_quarantine) {
    try {
      // کاربر را از تمام گروه‌های دیگر به جز گروه فعلی حذف کن
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
      
      // به روز رسانی گروه فعلی کاربر
      await supabase
        .from('users')
        .update({ current_chat: ctx.chat.id })
        .eq('user_id', user.id);
        
    } catch (error) {
      console.error('حذف کاربر ناموفق بود:', error);
    }
  } else {
    // کاربر جدید - اضافه کردن به دیتابیس
    const { error } = await supabase
      .from('users')
      .upsert({
        user_id: user.id,
        username: user.username,
        in_quarantine: true,
        current_chat: ctx.chat.id
      }, { onConflict: 'user_id' });
      
    if (error) console.error(error);
  }
}

// دستور start
bot.start(async (ctx) => {
  const { data: isOwner } = await supabase
    .from('allowed_owners')
    .select('*')
    .eq('owner_id', ctx.from.id)
    .single();

  if (!isOwner) {
    return;
  }

  const { error } = await supabase
    .from('users')
    .upsert({
      user_id: ctx.from.id,
      username: ctx.from.username,
      in_quarantine: false,
      current_chat: null
    }, { onConflict: 'user_id' });

  if (error) {
    console.error(error);
  }
});

// مدیریت اضافه شدن به گروه
bot.on('new_chat_members', async (ctx) => {
  const newMembers = ctx.message.new_chat_members;
  
  for (const member of newMembers) {
    if (member.is_bot && member.username === ctx.botInfo.username) {
      if (!(await isChatAdmin(ctx.chat.id, ctx.message.from.id))) {
        await ctx.leaveChat();
        return;
      }
      
      const { error } = await supabase
        .from('allowed_chats')
        .upsert({
          chat_id: ctx.chat.id,
          chat_title: ctx.chat.title
        }, { onConflict: 'chat_id' });
        
      if (error) console.error(error);
      
    } else {
      await handleNewUser(ctx, member);
    }
  }
});

// دستور #فعال
bot.hears('#فعال', async (ctx) => {
  if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) {
    return;
  }
  
  const { error } = await supabase
    .from('allowed_chats')
    .upsert({
      chat_id: ctx.chat.id,
      chat_title: ctx.chat.title
    }, { onConflict: 'chat_id' });
    
  if (error) {
    console.error(error);
  }
});

// دستور #ورود
bot.hears('#ورود', async (ctx) => {
  if (!ctx.userData) {
    const { error } = await supabase
      .from('users')
      .insert({
        user_id: ctx.from.id,
        username: ctx.from.username,
        in_quarantine: true,
        current_chat: ctx.chat.id
      });
      
    if (error) {
      console.error(error);
    }
  } else {
    const { error } = await supabase
      .from('users')
      .update({ 
        in_quarantine: true, 
        current_chat: ctx.chat.id 
      })
      .eq('user_id', ctx.from.id);
      
    if (error) {
      console.error(error);
    }
  }
});

// دستور #خروج
bot.hears('#خروج', async (ctx) => {
  if (!ctx.userData?.in_quarantine) {
    return;
  }
  
  const { error } = await supabase
    .from('users')
    .update({ 
      in_quarantine: false, 
      current_chat: null 
    })
    .eq('user_id', ctx.from.id);
    
  if (error) {
    console.error(error);
  }
});

// دستور #حذف (برای ادمین‌ها)
bot.on('message', async (ctx) => {
  if (ctx.message.text === '#حذف' && ctx.message.reply_to_message) {
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) {
      return;
    }
    
    const targetUser = ctx.message.reply_to_message.from;
    
    const { error } = await supabase
      .from('users')
      .update({ 
        in_quarantine: false, 
        current_chat: null 
      })
      .eq('user_id', targetUser.id);
    
    if (error) {
      console.error(error);
    }
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
