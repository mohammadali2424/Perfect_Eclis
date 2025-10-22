const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// تنظیمات اصلی
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

// پینگ خودکار
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

// توابع اصلی
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
    console.error(`❌ خطا در حذف کاربر:`, error.message);
    return false;
  }
};

// تابع اصلی قرنطینه - ساده و کارآمد
const quarantineUser = async (ctx, user) => {
  try {
    const currentChatId = ctx.chat.id.toString();
    console.log(`🔒 قرنطینه کاربر: ${user.first_name} (${user.id}) در گروه ${currentChatId}`);

    // 1. بررسی کاربر در سایر ربات‌ها
    for (const botInstance of BOT_INSTANCES) {
      if (botInstance.id === SELF_BOT_ID || botInstance.type !== 'quarantine') continue;
      
      try {
        let apiUrl = botInstance.url;
        if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
        
        const response = await axios.post(`${apiUrl.replace(/\/$/, '')}/api/check-quarantine`, {
          userId: user.id,
          secretKey: botInstance.secretKey || API_SECRET_KEY,
          sourceBot: SELF_BOT_ID
        }, { timeout: 5000 });

        if (response.data.isQuarantined) {
          console.log(`🚫 کاربر در ربات ${botInstance.id} قرنطینه است`);
          
          // حذف کاربر از گروه فعلی
          await removeUserFromChat(currentChatId, user.id);
          return false;
        }
      } catch (error) {
        // خطا را نادیده بگیر
      }
    }

    // 2. ثبت کاربر در دیتابیس
    await supabase.from('quarantine_users').upsert({
      user_id: user.id,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    // 3. حذف کاربر از سایر گروه‌ها
    const { data: allChats } = await supabase.from('allowed_chats').select('chat_id, chat_title');
    if (allChats) {
      for (const chat of allChats) {
        if (chat.chat_id.toString() === currentChatId) continue;
        
        try {
          const member = await bot.telegram.getChatMember(chat.chat_id, user.id);
          if (['member', 'administrator'].includes(member.status)) {
            await removeUserFromChat(chat.chat_id, user.id);
          }
        } catch (error) {
          // کاربر در گروه نیست
        }
      }
    }

    console.log(`✅ کاربر ${user.id} با موفقیت قرنطینه شد`);
    return true;

  } catch (error) {
    console.error('❌ خطا در قرنطینه:', error);
    return false;
  }
};

// پردازش کاربران جدید
bot.on('new_chat_members', async (ctx) => {
  try {
    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        console.log(`👤 کاربر جدید: ${member.first_name} (${member.id})`);
        
        // بررسی اینکه گروه فعال است
        const { data: allowedChat } = await supabase
          .from('allowed_chats')
          .select('chat_id')
          .eq('chat_id', ctx.chat.id.toString())
          .single();

        if (allowedChat) {
          await quarantineUser(ctx, member);
        }
      }
    }
  } catch (error) {
    console.error('❌ خطا در پردازش کاربر جدید:', error);
  }
});

// endpointهای API
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
      currentChatId: user ? user.current_chat_id : null,
      botId: SELF_BOT_ID
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
      await supabase
        .from('quarantine_users')
        .upsert({
          user_id: userId,
          is_quarantined: true,
          current_chat_id: chatId,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
    }
    
    res.status(200).json({ success: true, botId: SELF_BOT_ID });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// دستورات مدیریتی
bot.command('on', async (ctx) => {
  if (!(await isBotAdmin(ctx.chat.id))) {
    ctx.reply('❌ ربات باید ادمین باشد');
    return;
  }

  const chatId = ctx.chat.id.toString();
  
  try {
    await supabase.from('allowed_chats').upsert({
      chat_id: chatId,
      chat_title: ctx.chat.title,
      created_at: new Date().toISOString()
    }, { onConflict: 'chat_id' });

    ctx.reply('✅ ربات فعال شد! کاربران جدید قرنطینه خواهند شد.');
  } catch (error) {
    ctx.reply('❌ خطا در فعال‌سازی');
  }
});

bot.command('off', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  
  try {
    await supabase.from('allowed_chats').delete().eq('chat_id', chatId);
    ctx.reply('❌ ربات غیرفعال شد');
  } catch (error) {
    ctx.reply('❌ خطا در غیرفعال‌سازی');
  }
});

// راه‌اندازی
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
