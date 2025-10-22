const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const NodeCache = require('node-cache');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================[ تنظیمات اولیه ]==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SELF_BOT_ID = process.env.SELF_BOT_ID;
const SYNC_ENABLED = process.env.SYNC_ENABLED === 'true';
const API_SECRET_KEY = process.env.API_SECRET_KEY;
const BOT_INSTANCES = process.env.BOT_INSTANCES ? JSON.parse(process.env.BOT_INSTANCES) : [];
const OWNER_ID = process.env.OWNER_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const cache = new NodeCache({ stdTTL: 300, checkperiod: 600 });

app.use(express.json());

// ==================[ توابع کمکی حیاتی - اصلاح شده ]==================

const isBotAdmin = async (chatId) => {
  try {
    const self = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    return ['administrator', 'creator'].includes(self.status);
  } catch (error) {
    console.error('خطا در بررسی ادمین بودن ربات:', error);
    return false;
  }
};

const removeUserFromChat = async (chatId, userId) => {
  try {
    if (!(await isBotAdmin(chatId))) {
      console.log(`❌ ربات در گروه ${chatId} ادمین نیست`);
      return false;
    }
    
    await bot.telegram.banChatMember(chatId, userId, {
      until_date: Math.floor(Date.now() / 1000) + 30
    });
    
    await bot.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
    console.log(`✅ کاربر ${userId} از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    console.error(`❌ خطا در حذف کاربر ${userId}:`, error.message);
    return false;
  }
};

// ==================[ تابع اصلی قرنطینه - کاملاً بازنویسی شده ]==================

const quarantineUser = async (ctx, user) => {
  try {
    console.log(`🔒 شروع فرآیند قرنطینه برای کاربر: ${user.first_name} (${user.id})`);
    
    const currentChatId = ctx.chat.id.toString();
    const currentChatTitle = ctx.chat.title || 'بدون عنوان';

    // 🔍 مرحله 1: ابتدا بررسی کن کاربر در ربات‌های دیگر قرنطینه است
    if (SYNC_ENABLED) {
      console.log(`🔍 بررسی کاربر ${user.id} در سایر ربات‌ها...`);
      const userInOtherBot = await checkUserInOtherBots(user.id);
      
      if (userInOtherBot.found) {
        console.log(`🚫 کاربر ${user.id} در ربات ${userInOtherBot.botId} قرنطینه است - حذف از گروه فعلی`);
        
        // فقط از گروه جدید حذف کن، نه از گروه قدیمی
        await removeUserFromChat(currentChatId, user.id);
        return false;
      }
    }

    // 🔍 مرحله 2: بررسی وضعیت کاربر در دیتابیس محلی
    const { data: existingUser } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // اگر کاربر در گروه دیگری قرنطینه است
    if (existingUser && existingUser.is_quarantined && existingUser.current_chat_id !== currentChatId) {
      console.log(`🚫 کاربر در گروه ${existingUser.current_chat_id} قرنطینه است - حذف از گروه فعلی`);
      await removeUserFromChat(currentChatId, user.id);
      return false;
    }

    // ✅ کاربر می‌تواند در این گروه قرنطینه شود
    console.log(`🔄 ثبت کاربر ${user.id} در قرنطینه گروه ${currentChatId}...`);
    
    // ثبت کاربر در دیتابیس
    await supabase.from('quarantine_users').upsert({
      user_id: user.id,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    // 🗑️ حذف کاربر از سایر گروه‌های محلی
    await removeUserFromOtherLocalChats(currentChatId, user.id);

    // 🔄 هماهنگی با سایر ربات‌ها
    if (SYNC_ENABLED) {
      await syncUserWithOtherBots(user.id, currentChatId, 'quarantine');
    }

    console.log(`✅ کاربر ${user.id} با موفقیت قرنطینه شد`);
    return true;
    
  } catch (error) {
    console.error('❌ خطا در فرآیند قرنطینه:', error);
    return false;
  }
};

// ==================[ تابع حذف از گروه‌های دیگر - اصلاح شده ]==================

const removeUserFromOtherLocalChats = async (currentChatId, userId) => {
  try {
    console.log(`🗑️ در حال حذف کاربر ${userId} از گروه‌های دیگر...`);
    
    const { data: allChats } = await supabase.from('allowed_chats').select('chat_id, chat_title');
    if (!allChats) return;

    let removedCount = 0;
    for (const chat of allChats) {
      const chatIdStr = chat.chat_id.toString();
      if (chatIdStr === currentChatId.toString()) continue;

      try {
        const member = await bot.telegram.getChatMember(chat.chat_id, userId);
        if (['member', 'administrator'].includes(member.status)) {
          const removed = await removeUserFromChat(chat.chat_id, userId);
          if (removed) removedCount++;
        }
      } catch (error) {
        // کاربر در گروه نیست
      }
    }
    console.log(`✅ کاربر ${userId} از ${removedCount} گروه دیگر حذف شد`);
  } catch (error) {
    console.error('❌ خطا در حذف از گروه‌های دیگر:', error);
  }
};

// ==================[ توابع هماهنگی چندرباتی - اصلاح شده ]==================

const checkUserInOtherBots = async (userId) => {
  try {
    if (!SYNC_ENABLED) return { found: false };

    const promises = BOT_INSTANCES
      .filter(botInstance => botInstance.id !== SELF_BOT_ID && botInstance.type === 'quarantine')
      .map(async (botInstance) => {
        try {
          let apiUrl = botInstance.url;
          if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
          
          const response = await axios.post(`${apiUrl.replace(/\/$/, '')}/api/check-quarantine`, {
            userId: userId,
            secretKey: botInstance.secretKey || API_SECRET_KEY,
            sourceBot: SELF_BOT_ID
          }, { timeout: 8000 });

          if (response.data.isQuarantined) {
            return { 
              found: true, 
              botId: botInstance.id, 
              chatId: response.data.currentChatId
            };
          }
        } catch (error) {
          // خطا را نادیده بگیر اگر ربات در دسترس نیست
        }
        return null;
      });

    const results = await Promise.all(promises);
    const foundResult = results.find(result => result !== null);
    
    return foundResult || { found: false };
  } catch (error) {
    console.error('❌ خطا در بررسی کاربر در سایر ربات‌ها:', error);
    return { found: false };
  }
};

const syncUserWithOtherBots = async (userId, chatId, action) => {
  try {
    if (!SYNC_ENABLED) return;

    const promises = BOT_INSTANCES
      .filter(botInstance => botInstance.id !== SELF_BOT_ID)
      .map(async (botInstance) => {
        try {
          let apiUrl = botInstance.url;
          if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
          
          await axios.post(`${apiUrl.replace(/\/$/, '')}/api/sync-user`, {
            userId: userId,
            chatId: chatId,
            action: action,
            secretKey: botInstance.secretKey || API_SECRET_KEY,
            sourceBot: SELF_BOT_ID
          }, { timeout: 5000 });
          
          console.log(`✅ هماهنگی با ${botInstance.id} موفق`);
        } catch (error) {
          // خطا را نادیده بگیر
        }
      });

    await Promise.all(promises);
  } catch (error) {
    console.error('❌ خطا در هماهنگی با ربات‌ها:', error);
  }
};

// ==================[ پردازش اعضای جدید - اصلاح شده ]==================

bot.on('new_chat_members', async (ctx) => {
  try {
    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        console.log(`👤 کاربر جدید: ${member.first_name} (${member.id})`);
        await quarantineUser(ctx, member);
      }
    }
  } catch (error) {
    console.error('❌ خطا در پردازش عضو جدید:', error);
  }
});

// ==================[ endpointهای API - حیاتی برای هماهنگی ]==================

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
      username: user ? user.username : null,
      firstName: user ? user.first_name : null,
      botId: SELF_BOT_ID
    });
  } catch (error) {
    console.error('❌ خطا در endpoint بررسی قرنطینه:', error);
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
    } else if (action === 'release') {
      await supabase
        .from('quarantine_users')
        .update({ 
          is_quarantined: false,
          current_chat_id: null
        })
        .eq('user_id', userId);
    }
    
    res.status(200).json({ success: true, botId: SELF_BOT_ID });
  } catch (error) {
    console.error('❌ خطا در endpoint هماهنگی:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================[ راه‌اندازی سرور ]==================

app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => res.send('ربات قرنطینه فعال است!'));

app.listen(PORT, () => {
  console.log(`✅ ربات قرنطینه ${SELF_BOT_ID} روی پورت ${PORT} راه‌اندازی شد`);
});

// فعال‌سازی Webhook یا Polling
if (process.env.RENDER_EXTERNAL_URL) {
  bot.telegram.setWebhook(`${process.env.RENDER_EXTERNAL_URL}/webhook`);
} else {
  bot.launch();
                           }
