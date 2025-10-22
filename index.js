const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================[ تنظیمات ]==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SELF_BOT_ID = process.env.SELF_BOT_ID;
const API_SECRET_KEY = process.env.API_SECRET_KEY;
const BOT_INSTANCES = process.env.BOT_INSTANCES ? JSON.parse(process.env.BOT_INSTANCES) : [];
const OWNER_ID = process.env.OWNER_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
app.use(express.json());

// ==================[ پینگ خودکار ]==================
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) return;
  
  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  const performPing = async () => {
    try {
      await axios.get(`${selfUrl}/ping`, { timeout: 10000 });
      console.log('✅ پینگ موفق');
    } catch (error) {
      console.error('❌ پینگ ناموفق:', error.message);
    }
  };

  setTimeout(performPing, 30000);
  setInterval(performPing, PING_INTERVAL);
};

app.get('/ping', (req, res) => {
  res.status(200).json({ status: 'active', botId: SELF_BOT_ID });
});

// ==================[ توابع اصلی - منطق جدید ]==================
const isBotAdmin = async (chatId) => {
  try {
    const self = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    return ['administrator', 'creator'].includes(self.status);
  } catch (error) {
    return false;
  }
};

const removeUserFromChat = async (chatId, userId) => {
  try {
    if (!(await isBotAdmin(chatId))) return false;
    
    await bot.telegram.banChatMember(chatId, userId, {
      until_date: Math.floor(Date.now() / 1000) + 30
    });
    
    await bot.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
    console.log(`✅ کاربر ${userId} از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    return false;
  }
};

// ==================[ منطق جدید: مدیریت قرنطینه ]==================
const handleUserJoin = async (ctx, user) => {
  try {
    console.log(`🔍 پردازش کاربر ${user.id} در گروه ${ctx.chat.id}`);
    
    const currentChatId = ctx.chat.id.toString();
    const currentChatTitle = ctx.chat.title || 'بدون عنوان';

    // 1. بررسی اینکه کاربر در ربات‌های دیگر قرنطینه است
    const userInOtherBot = await checkOtherBots(user.id);
    if (userInOtherBot.found) {
      console.log(`🚫 کاربر در ربات ${userInOtherBot.botId} قرنطینه است`);
      await removeUserFromChat(currentChatId, user.id);
      
      // اطلاع به ربات قبلی برای حذف کاربر از گروهش
      await notifyBotToRemoveUser(userInOtherBot.botId, user.id, userInOtherBot.chatId);
      return;
    }

    // 2. بررسی اینکه کاربر در گروه‌های دیگر همین ربات هست
    await removeFromOtherChats(currentChatId, user.id, user.first_name);

    // 3. ثبت کاربر در قرنطینه
    await registerUser(user, currentChatId);

    // 4. هماهنگی با سایر ربات‌ها
    await syncWithOtherBots(user.id, currentChatId, 'quarantine');

    console.log(`✅ کاربر ${user.id} با موفقیت قرنطینه شد`);

  } catch (error) {
    console.error('❌ خطا در پردازش کاربر:', error);
  }
};

// بررسی کاربر در ربات‌های دیگر
const checkOtherBots = async (userId) => {
  for (const botInstance of BOT_INSTANCES) {
    if (botInstance.id === SELF_BOT_ID) continue;
    
    try {
      let apiUrl = botInstance.url;
      if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
      
      const response = await axios.post(`${apiUrl.replace(/\/$/, '')}/api/check-quarantine`, {
        userId: userId,
        secretKey: botInstance.secretKey || API_SECRET_KEY
      }, { timeout: 5000 });

      if (response.data.isQuarantined) {
        return { 
          found: true, 
          botId: botInstance.id, 
          chatId: response.data.currentChatId 
        };
      }
    } catch (error) {
      // ادامه به ربات بعدی
    }
  }
  return { found: false };
};

// حذف کاربر از گروه‌های دیگر همین ربات
const removeFromOtherChats = async (currentChatId, userId, userName) => {
  try {
    const { data: allChats } = await supabase.from('allowed_chats').select('chat_id, chat_title');
    if (!allChats) return;

    for (const chat of allChats) {
      if (chat.chat_id.toString() === currentChatId) continue;
      
      try {
        const member = await bot.telegram.getChatMember(chat.chat_id, userId);
        if (['member', 'administrator'].includes(member.status)) {
          await removeUserFromChat(chat.chat_id, userId);
          console.log(`✅ کاربر از گروه ${chat.chat_id} حذف شد`);
        }
      } catch (error) {
        // کاربر در گروه نیست
      }
    }
  } catch (error) {
    console.error('خطا در حذف از گروه‌های دیگر:', error);
  }
};

// ثبت کاربر در دیتابیس
const registerUser = async (user, chatId) => {
  await supabase.from('quarantine_users').upsert({
    user_id: user.id,
    username: user.username,
    first_name: user.first_name,
    is_quarantined: true,
    current_chat_id: chatId,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
};

// اطلاع به ربات دیگر برای حذف کاربر
const notifyBotToRemoveUser = async (botId, userId, chatId) => {
  try {
    const botInstance = BOT_INSTANCES.find(bot => bot.id === botId);
    if (!botInstance) return;

    let apiUrl = botInstance.url;
    if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
    
    await axios.post(`${apiUrl.replace(/\/$/, '')}/api/remove-user`, {
      userId: userId,
      chatId: chatId,
      secretKey: botInstance.secretKey || API_SECRET_KEY,
      reason: 'user_joined_another_bot'
    }, { timeout: 5000 });
    
    console.log(`✅ به ربات ${botId} اطلاع داده شد`);
  } catch (error) {
    console.error(`❌ خطا در اطلاع به ربات ${botId}:`, error.message);
  }
};

// هماهنگی با سایر ربات‌ها
const syncWithOtherBots = async (userId, chatId, action) => {
  for (const botInstance of BOT_INSTANCES) {
    if (botInstance.id === SELF_BOT_ID) continue;
    
    try {
      let apiUrl = botInstance.url;
      if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
      
      await axios.post(`${apiUrl.replace(/\/$/, '')}/api/sync-user`, {
        userId: userId,
        chatId: chatId,
        action: action,
        secretKey: botInstance.secretKey || API_SECRET_KEY
      }, { timeout: 5000 });
    } catch (error) {
      // ادامه به ربات بعدی
    }
  }
};

// ==================[ پردازش کاربران جدید ]==================
bot.on('new_chat_members', async (ctx) => {
  for (const member of ctx.message.new_chat_members) {
    if (!member.is_bot) {
      await handleUserJoin(ctx, member);
    }
  }
});

// ==================[ endpointهای API ]==================
app.post('/api/check-quarantine', async (req, res) => {
  try {
    const { userId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { data: user } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', userId)
      .single();
      
    res.status(200).json({ 
      isQuarantined: user ? user.is_quarantined : false,
      currentChatId: user ? user.current_chat_id : null
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/sync-user', async (req, res) => {
  try {
    const { userId, chatId, action, secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (action === 'quarantine') {
      await supabase.from('quarantine_users').upsert({
        user_id: userId,
        is_quarantined: true,
        current_chat_id: chatId,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
    } else if (action === 'release') {
      await supabase
        .from('quarantine_users')
        .update({ 
          is_quarantined: false,
          current_chat_id: null
        })
        .eq('user_id', userId);
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/remove-user', async (req, res) => {
  try {
    const { userId, chatId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    await removeUserFromChat(chatId, userId);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================[ دستورات مدیریتی ]==================
bot.command('on', async (ctx) => {
  if (!(await isBotAdmin(ctx.chat.id))) {
    ctx.reply('❌ ربات باید ادمین باشد');
    return;
  }

  const chatId = ctx.chat.id.toString();
  
  // بررسی اینکه گروه قبلاً فعال شده یا نه
  const { data: existingChat } = await supabase
    .from('allowed_chats')
    .select('chat_id')
    .eq('chat_id', chatId)
    .single();

  if (existingChat) {
    ctx.reply('✅ ربات قبلاً فعال شده است');
    return;
  }

  await supabase.from('allowed_chats').insert({
    chat_id: chatId,
    chat_title: ctx.chat.title,
    created_at: new Date().toISOString()
  });

  ctx.reply('✅ ربات فعال شد! کاربران جدید قرنطینه خواهند شد.');
});

bot.command('free', async (ctx) => {
  if (!ctx.message.reply_to_message) {
    ctx.reply('❌ روی پیام کاربر ریپلای کنید');
    return;
  }

  const targetUser = ctx.message.reply_to_message.from;
  if (targetUser.is_bot) return;

  await supabase
    .from('quarantine_users')
    .update({ 
      is_quarantined: false,
      current_chat_id: null
    })
    .eq('user_id', targetUser.id);

  await syncWithOtherBots(targetUser.id, null, 'release');
  ctx.reply(`✅ کاربر ${targetUser.first_name} آزاد شد`);
});

// ==================[ راه‌اندازی ]==================
app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => res.send('ربات قرنطینه فعال است'));

app.listen(PORT, () => {
  console.log(`🚀 ربات قرنطینه ${SELF_BOT_ID} راه‌اندازی شد`);
  startAutoPing();
});

if (process.env.RENDER_EXTERNAL_URL) {
  bot.telegram.setWebhook(`${process.env.RENDER_EXTERNAL_URL}/webhook`);
} else {
  bot.launch();
      }
