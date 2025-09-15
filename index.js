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

// دستور start
bot.start(async (ctx) => {
  // بررسی مالک بودن
  const { data: isOwner } = await supabase
    .from('allowed_owners')
    .select('*')
    .eq('owner_id', ctx.from.id)
    .single();

  if (!isOwner) {
    return ctx.reply('شما مجاز به استفاده از این ربات نیستید.');
  }

  // ذخیره کاربر
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
    return ctx.reply('خطایی رخ داده است.');
  }

  ctx.reply('ربات فعال شد! از /help برای راهنما استفاده کنید.');
});

// دستور help
bot.help((ctx) => {
  ctx.reply(`
دستورات قابل استفاده:
/start - فعال سازی ربات (فقط برای مالکین)
#ورود - ورود دستی به قرنطینه
#خروج - خروج از قرنطینه
#فعال - فعال سازی ربات در گروه
  `);
});

// مدیریت اضافه شدن به گروه
bot.on('new_chat_members', async (ctx) => {
  const newMembers = ctx.message.new_chat_members;
  
  for (const member of newMembers) {
    // اگر ربات باشد
    if (member.is_bot && member.username === ctx.botInfo.username) {
      // بررسی ادمین بودن افزودن‌کننده
      if (!(await isChatAdmin(ctx.chat.id, ctx.message.from.id))) {
        await ctx.leaveChat();
        return;
      }
      
      // ذخیره گروه
      const { error } = await supabase
        .from('allowed_chats')
        .upsert({
          chat_id: ctx.chat.id,
          chat_title: ctx.chat.title
        }, { onConflict: 'chat_id' });
        
      if (error) console.error(error);
      
      await ctx.reply('ربات با موفقیت فعال شد!');
    } else {
      // اگر کاربر عادی باشد
      await handleNewUser(ctx, member);
    }
  }
});

// دستور #فعال
bot.hears('#فعال', async (ctx) => {
  // بررسی ادمین بودن
  if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) {
    return ctx.reply('فقط ادمین‌ها می‌توانند ربات را فعال کنند.');
  }
  
  // ذخیره گروه
  const { error } = await supabase
    .from('allowed_chats')
    .upsert({
      chat_id: ctx.chat.id,
      chat_title: ctx.chat.title
    }, { onConflict: 'chat_id' });
    
  if (error) {
    console.error(error);
    return ctx.reply('خطایی در فعال سازی ربات رخ داد.');
  }
  
  ctx.reply('ربات در این گروه فعال شد!');
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
      return ctx.reply('خطایی رخ داده است.');
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
      return ctx.reply('خطایی رخ داده است.');
    }
  }
  
  ctx.reply('شما با دستور وارد قرنطینه شدید.');
});

// دستور #خروج
bot.hears('#خروج', async (ctx) => {
  if (!ctx.userData?.in_quarantine) {
    return ctx.reply('شما در قرنطینه نیستید.');
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
    return ctx.reply('خطایی رخ داده است.');
  }
  
  ctx.reply('شما از قرنطینه خارج شدید.');
});

// تابع بررسی ادمین
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
  // بررسی آیا کاربر در قرنطینه است
  const { data: userData } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', user.id)
    .single();
    
  if (userData?.in_quarantine) {
    try {
      await ctx.kickChatMember(user.id);
      await ctx.reply(`کاربر ${user.first_name} به دلیل قرنطینه اخراج شد.`);
      
      // اخراج از گروه قبلی
      if (userData.current_chat && userData.current_chat !== ctx.chat.id) {
        try {
          await bot.telegram.kickChatMember(userData.current_chat, user.id);
        } catch (error) {
          console.error('اخراج از گروه قبلی ناموفق بود:', error);
        }
      }
      
      // به روز رسانی گروه فعلی
      await supabase
        .from('users')
        .update({ current_chat: ctx.chat.id })
        .eq('user_id', user.id);
        
    } catch (error) {
      console.error('اخراج کاربر ناموفق بود:', error);
    }
  } else {
    // افزودن کاربر جدید به دیتابیس
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