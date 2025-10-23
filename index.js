const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const winston = require('winston');
const cron = require('node-cron');
const NodeCache = require('node-cache');
const helmet = require('helmet');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware امنیتی
app.use(helmet());
app.use(cors());
app.use(express.json());

// ==================[ تنظیمات اولیه ]==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SELF_BOT_ID = process.env.SELF_BOT_ID || 'quarantine_1';
const SYNC_ENABLED = process.env.SYNC_ENABLED === 'true';
const API_SECRET_KEY = process.env.API_SECRET_KEY;
const BOT_INSTANCES = process.env.BOT_INSTANCES ? JSON.parse(process.env.BOT_INSTANCES) : [];
const OWNER_ID = parseInt(process.env.OWNER_ID) || 0;

// کش پیشرفته برای کاهش درخواست‌های دیتابیس
const cache = new NodeCache({ 
  stdTTL: 900,
  checkperiod: 300,
  maxKeys: 5000,
  useClones: false
});

// ==================[ پینگ خودکار ]==================
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) return;
  
  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  const performPing = async () => {
    try {
      await axios.get(`${selfUrl}/ping`, { timeout: 10000 });
      console.log('✅ پینگ موفق - قرنطینه');
    } catch (error) {
      console.error('❌ پینگ ناموفق - قرنطینه:', error.message);
      setTimeout(performPing, 2 * 60 * 1000);
    }
  };

  setTimeout(performPing, 30000);
  setInterval(performPing, PING_INTERVAL);
};

// endpoint پینگ
app.get('/ping', (req, res) => {
  res.status(200).json({
    status: 'active',
    botId: SELF_BOT_ID,
    timestamp: new Date().toISOString()
  });
});

// ==================[ توابع مالکیت و دسترسی ]==================
const isOwner = (userId) => {
  if (!OWNER_ID) {
    console.log('⚠️ OWNER_ID تنظیم نشده است');
    return false;
  }
  
  const isOwner = userId === OWNER_ID;
  return isOwner;
};

const isOwnerOrCreator = async (ctx) => {
  try {
    const userId = ctx.from.id;
    
    if (isOwner(userId)) {
      return { hasAccess: true, isOwner: true, reason: 'مالک ربات' };
    }
    
    if (ctx.chat.type === 'private') {
      return { hasAccess: false, reason: 'این دستور فقط در گروه کار می‌کند' };
    }

    const member = await ctx.getChatMember(userId);
    if (member.status === 'creator') {
      return { hasAccess: true, isCreator: true, reason: 'سازنده گروه' };
    }

    return { hasAccess: false, reason: 'شما دسترسی لازم را ندارید' };
  } catch (error) {
    console.error('❌ خطا در بررسی دسترسی:', error);
    return { hasAccess: false, reason: 'خطا در بررسی دسترسی' };
  }
};

// ==================[ کش پیشرفته ]==================
const cacheManager = {
  setUser: (userId, userData) => {
    cache.set(`user:${userId}`, userData, 300);
  },
  
  getUser: (userId) => {
    return cache.get(`user:${userId}`);
  },
  
  setAllowedChat: (chatId, chatData) => {
    cache.set(`chat:${chatId}`, chatData, 600);
  },
  
  getAllowedChat: (chatId) => {
    return cache.get(`chat:${chatId}`);
  },
  
  setAdminStatus: (chatId, userId, isAdmin) => {
    cache.set(`admin:${chatId}:${userId}`, isAdmin, 300);
  },
  
  getAdminStatus: (chatId, userId) => {
    return cache.get(`admin:${chatId}:${userId}`);
  },
  
  setBotCheckResult: (userId, result) => {
    cache.set(`botcheck:${userId}`, result, 180);
  },
  
  getBotCheckResult: (userId) => {
    return cache.get(`botcheck:${userId}`);
  },
  
  invalidateUser: (userId) => {
    cache.del(`user:${userId}`);
    cache.del(`botcheck:${userId}`);
  }
};

// Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

// ==================[ توابع اصلی - کاملاً اصلاح شده ]==================
const isBotAdmin = async (chatId) => {
  try {
    const cacheKey = `botadmin:${chatId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    const self = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    const isAdmin = ['administrator', 'creator'].includes(self.status);
    
    cache.set(cacheKey, isAdmin, 300);
    return isAdmin;
  } catch (error) {
    console.error('❌ خطا در بررسی ادمین بودن ربات:', error);
    return false;
  }
};

const getUserStatus = async (chatId, userId) => {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return member.status;
  } catch (error) {
    if (error.response?.error_code === 400) return 'not_member';
    if (error.response?.error_code === 403) return 'bot_not_in_chat';
    return null;
  }
};

const removeUserFromChat = async (chatId, userId) => {
  try {
    if (!(await isBotAdmin(chatId))) {
      console.log(`❌ ربات در گروه ${chatId} ادمین نیست`);
      return false;
    }
    
    const userStatus = await getUserStatus(chatId, userId);
    if (['left', 'kicked', 'not_member'].includes(userStatus)) {
      return true;
    }
    
    if (userStatus === 'creator') {
      console.log(`❌ نمی‌توان سازنده گروه را حذف کرد`);
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

// ==================[ تابع جدید: حذف کاربر از تمام گروه‌های دیگر - کاملاً اصلاح شده ]==================
const removeUserFromAllOtherChats = async (currentChatId, userId) => {
  try {
    console.log(`🗑️ شروع حذف کاربر ${userId} از تمام گروه‌های دیگر به جز ${currentChatId}`);
    
    let totalRemoved = 0;
    
    // 1. حذف از گروه‌های محلی این ربات
    const localRemoved = await removeUserFromLocalChats(currentChatId, userId);
    totalRemoved += localRemoved;
    
    // 2. حذف از گروه‌های ربات‌های قرنطینه دیگر
    const quarantineRemoved = await removeUserFromOtherQuarantineBots(currentChatId, userId);
    totalRemoved += quarantineRemoved;
    
    // 3. حذف از گروه‌های ربات‌های تریگر
    const triggerRemoved = await removeUserFromTriggerBots(currentChatId, userId);
    totalRemoved += triggerRemoved;
    
    console.log(`✅ کاربر ${userId} از ${totalRemoved} گروه دیگر حذف شد`);
    return totalRemoved;
  } catch (error) {
    console.error('❌ خطا در حذف کاربر از گروه‌های دیگر:', error);
    return 0;
  }
};

// ==================[ تابع حذف از گروه‌های محلی - اصلاح شده ]==================
const removeUserFromLocalChats = async (currentChatId, userId) => {
  try {
    let allChats = cache.get('allowed_chats');
    
    if (!allChats) {
      const { data } = await supabase.from('allowed_chats').select('chat_id, chat_title');
      if (data) {
        allChats = data;
        cache.set('allowed_chats', data, 300);
      } else {
        return 0;
      }
    }

    let removedCount = 0;
    for (const chat of allChats) {
      const chatIdStr = chat.chat_id.toString();
      if (chatIdStr === currentChatId.toString()) continue;

      try {
        const userStatus = await getUserStatus(chat.chat_id, userId);
        if (userStatus && !['left', 'kicked', 'not_member', 'bot_not_in_chat'].includes(userStatus)) {
          const removed = await removeUserFromChat(chat.chat_id, userId);
          if (removed) removedCount++;
        }
      } catch (error) {
        // کاربر در گروه نیست یا خطای دیگر
      }
    }
    
    if (removedCount > 0) {
      console.log(`✅ کاربر ${userId} از ${removedCount} گروه محلی حذف شد`);
    }
    
    return removedCount;
  } catch (error) {
    console.error('❌ خطا در حذف از گروه‌های محلی:', error);
    return 0;
  }
};

// ==================[ تابع جدید: حذف از ربات‌های قرنطینه دیگر ]==================
const removeUserFromOtherQuarantineBots = async (currentChatId, userId) => {
  try {
    if (!SYNC_ENABLED) {
      console.log('🔕 سینک غیرفعال - حذف از ربات‌های قرنطینه دیگر انجام نشد');
      return 0;
    }

    const otherQuarantineBots = BOT_INSTANCES.filter(bot => 
      bot.id !== SELF_BOT_ID && bot.type === 'quarantine'
    );
    
    if (otherQuarantineBots.length === 0) {
      return 0;
    }

    let removedCount = 0;
    const promises = otherQuarantineBots.map(async (botInstance) => {
      try {
        let apiUrl = botInstance.url;
        if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
        
        const response = await axios.post(`${apiUrl}/api/remove-user-from-all-chats`, {
          userId: userId,
          currentChatId: currentChatId,
          secretKey: botInstance.secretKey || API_SECRET_KEY,
          sourceBot: SELF_BOT_ID
        }, { timeout: 10000 });

        if (response.data.success) {
          console.log(`✅ درخواست حذف کاربر ${userId} از ربات ${botInstance.id} ارسال شد`);
          return response.data.removedCount || 0;
        }
        return 0;
      } catch (error) {
        console.log(`❌ خطا در ارتباط با ربات ${botInstance.id}:`, error.message);
        return 0;
      }
    });

    const results = await Promise.allSettled(promises);
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        removedCount += result.value;
      }
    });

    console.log(`✅ کاربر ${userId} از ${removedCount} گروه در ربات‌های قرنطینه دیگر حذف شد`);
    return removedCount;
  } catch (error) {
    console.error('❌ خطا در حذف از ربات‌های قرنطینه دیگر:', error);
    return 0;
  }
};

// ==================[ تابع جدید: حذف از ربات‌های تریگر ]==================
const removeUserFromTriggerBots = async (currentChatId, userId) => {
  try {
    if (!SYNC_ENABLED) {
      return 0;
    }

    const triggerBots = BOT_INSTANCES.filter(bot => bot.type === 'trigger');
    
    if (triggerBots.length === 0) {
      return 0;
    }

    let removedCount = 0;
    const promises = triggerBots.map(async (botInstance) => {
      try {
        let apiUrl = botInstance.url;
        if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
        
        const response = await axios.post(`${apiUrl}/api/remove-user-from-all-chats`, {
          userId: userId,
          currentChatId: currentChatId,
          secretKey: botInstance.secretKey || API_SECRET_KEY,
          sourceBot: SELF_BOT_ID
        }, { timeout: 10000 });

        if (response.data.success) {
          console.log(`✅ درخواست حذف کاربر ${userId} از ربات تریگر ${botInstance.id} ارسال شد`);
          return response.data.removedCount || 0;
        }
        return 0;
      } catch (error) {
        console.log(`❌ خطا در ارتباط با ربات تریگر ${botInstance.id}:`, error.message);
        return 0;
      }
    });

    const results = await Promise.allSettled(promises);
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        removedCount += result.value;
      }
    });

    console.log(`✅ کاربر ${userId} از ${removedCount} گروه در ربات‌های تریگر حذف شد`);
    return removedCount;
  } catch (error) {
    console.error('❌ خطا در حذف از ربات‌های تریگر:', error);
    return 0;
  }
};

// ==================[ توابع هماهنگی بین ربات‌ها ]==================
const checkUserInAllOtherBots = async (userId) => {
  try {
    const cachedResult = cacheManager.getBotCheckResult(userId);
    if (cachedResult) {
      return cachedResult;
    }

    if (!SYNC_ENABLED || BOT_INSTANCES.length === 0) {
      return { found: false, botId: null, chatId: null };
    }

    const otherBots = BOT_INSTANCES.filter(bot => bot.id !== SELF_BOT_ID && bot.type === 'quarantine');
    
    if (otherBots.length === 0) {
      return { found: false, botId: null, chatId: null };
    }

    const promises = otherBots.map(async (botInstance) => {
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
        // خطا رو لاگ نکن
      }
      return null;
    });

    const results = await Promise.allSettled(promises);
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value !== null) {
        cacheManager.setBotCheckResult(userId, result.value);
        return result.value;
      }
    }

    const notFoundResult = { found: false, botId: null, chatId: null };
    cacheManager.setBotCheckResult(userId, notFoundResult);
    return notFoundResult;
  } catch (error) {
    return { found: false, botId: null, chatId: null };
  }
};

const notifyAllOtherBots = async (userId, chatId, action) => {
  try {
    if (!SYNC_ENABLED || BOT_INSTANCES.length === 0) return;

    const otherBots = BOT_INSTANCES.filter(bot => bot.id !== SELF_BOT_ID && bot.type === 'quarantine');
    if (otherBots.length === 0) return;

    otherBots.forEach(async (botInstance) => {
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
      } catch (error) {
        // خطا رو نادیده بگیر
      }
    });
  } catch (error) {
    console.error('❌ خطا در اطلاع‌رسانی به ربات‌ها:', error);
  }
};

// ==================[ تابع اصلی قرنطینه - کاملاً بازنویسی شده ]==================
const quarantineUser = async (ctx, user) => {
  try {
    const currentChatId = ctx.chat.id.toString();
    const userName = user.first_name || 'ناشناس';

    console.log(`🔍 شروع فرآیند قرنطینه برای کاربر ${user.id} در گروه ${currentChatId}`);

    // 1. بررسی کش
    const cachedUser = cacheManager.getUser(user.id);
    if (cachedUser && cachedUser.is_quarantined && cachedUser.current_chat_id !== currentChatId) {
      console.log(`🚫 کاربر در کش پیدا شد - حذف از گروه فعلی`);
      await removeUserFromChat(currentChatId, user.id);
      return false;
    }

    // 2. بررسی سایر ربات‌ها
    const userInOtherBot = await checkUserInAllOtherBots(user.id);
    if (userInOtherBot.found) {
      console.log(`🚫 کاربر در ربات ${userInOtherBot.botId} قرنطینه است`);
      await removeUserFromChat(currentChatId, user.id);
      return false;
    }

    // 3. بررسی دیتابیس
    const { data: existingUser } = await supabase
      .from('quarantine_users')
      .select('user_id, is_quarantined, current_chat_id')
      .eq('user_id', user.id)
      .single();

    if (existingUser && existingUser.is_quarantined && existingUser.current_chat_id !== currentChatId) {
      console.log(`🚫 کاربر در دیتابیس پیدا شد - حذف از گروه فعلی`);
      cacheManager.setUser(user.id, existingUser);
      await removeUserFromChat(currentChatId, user.id);
      return false;
    }

    // 4. قرنطینه کاربر
    const userData = {
      user_id: user.id,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId,
      updated_at: new Date().toISOString()
    };

    await supabase.from('quarantine_users').upsert(userData, { 
      onConflict: 'user_id' 
    });

    cacheManager.setUser(user.id, userData);

    // 5. حذف از تمام گروه‌های دیگر - این قسمت کلیدی است
    console.log(`🗑️ شروع حذف کاربر ${user.id} از تمام گروه‌های دیگر`);
    const removedCount = await removeUserFromAllOtherChats(currentChatId, user.id);
    
    // 6. اطلاع به سایر ربات‌ها
    await notifyAllOtherBots(user.id, currentChatId, 'quarantine');

    console.log(`✅ کاربر ${user.id} با موفقیت قرنطینه شد و از ${removedCount} گروه دیگر حذف شد`);
    return true;
    
  } catch (error) {
    console.error('❌ خطا در فرآیند قرنطینه:', error);
    return false;
  }
};

const releaseUserFromQuarantine = async (userId) => {
  try {
    await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);
    
    cacheManager.invalidateUser(userId);
    
    await notifyAllOtherBots(userId, null, 'release');
    
    console.log(`✅ کاربر ${userId} از قرنطینه آزاد شد`);
    return true;
  } catch (error) {
    console.error(`❌ خطا در آزادسازی کاربر ${userId}:`, error);
    return false;
  }
};

// ==================[ پردازش اعضای جدید ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    // اگر ربات اضافه شده باشد
    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot && member.id === ctx.botInfo.id) {
        console.log(`🤖 ربات به گروه ${ctx.chat.title} (${ctx.chat.id}) اضافه شد`);
        
        const addedBy = ctx.message.from;
        if (!isOwner(addedBy.id)) {
          console.log(`🚫 کاربر ${addedBy.id} مالک نیست - لفت دادن از گروه`);
          await ctx.reply('❌ فقط مالک ربات می‌تواند ربات را به گروه اضافه کند.');
          await ctx.leaveChat();
          return;
        }
        
        console.log(`✅ ربات توسط مالک ${addedBy.id} اضافه شد`);
        await ctx.reply('✅ ربات با موفقیت اضافه شد! از دستور /on برای فعال‌سازی استفاده کنید.');
        return;
      }
    }

    // پردازش کاربران عادی
    const chatId = ctx.chat.id.toString();
    let allowedChat = cacheManager.getAllowedChat(chatId);
    
    if (!allowedChat) {
      const { data } = await supabase
        .from('allowed_chats')
        .select('chat_id')
        .eq('chat_id', chatId)
        .single();
      
      if (data) {
        allowedChat = data;
        cacheManager.setAllowedChat(chatId, data);
      } else {
        return; // گروه فعال نیست
      }
    }

    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        await quarantineUser(ctx, member);
      }
    }
  } catch (error) {
    console.error('❌ خطا در پردازش عضو جدید:', error);
  }
});

// ==================[ endpointهای API - با endpoint جدید ]==================
app.post('/api/check-quarantine', async (req, res) => {
  try {
    const { userId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const cachedUser = cacheManager.getUser(userId);
    if (cachedUser) {
      return res.status(200).json({ 
        isQuarantined: cachedUser.is_quarantined,
        currentChatId: cachedUser.current_chat_id,
        botId: SELF_BOT_ID,
        source: 'cache'
      });
    }
    
    const { data: user } = await supabase
      .from('quarantine_users')
      .select('user_id, is_quarantined, current_chat_id')
      .eq('user_id', userId)
      .single();
      
    if (user) {
      cacheManager.setUser(userId, user);
    }
    
    res.status(200).json({ 
      isQuarantined: user ? user.is_quarantined : false,
      currentChatId: user ? user.current_chat_id : null,
      botId: SELF_BOT_ID,
      source: user ? 'database' : 'not_found'
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
      const userData = {
        user_id: userId,
        is_quarantined: true,
        current_chat_id: chatId,
        updated_at: new Date().toISOString()
      };
      
      await supabase.from('quarantine_users').upsert(userData, { onConflict: 'user_id' });
      cacheManager.setUser(userId, userData);
      
    } else if (action === 'release') {
      await supabase
        .from('quarantine_users')
        .update({ 
          is_quarantined: false,
          current_chat_id: null
        })
        .eq('user_id', userId);
      cacheManager.invalidateUser(userId);
    }
    
    res.status(200).json({ success: true, botId: SELF_BOT_ID });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================[ endpoint جدید: حذف کاربر از تمام گروه‌های این ربات ]==================
app.post('/api/remove-user-from-all-chats', async (req, res) => {
  try {
    const { userId, currentChatId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log(`🗑️ درخواست حذف کاربر ${userId} از تمام گروه‌های این ربات (به جز ${currentChatId})`);
    
    const removedCount = await removeUserFromLocalChats(currentChatId, userId);
    
    res.status(200).json({ 
      success: true,
      removedCount: removedCount,
      botId: SELF_BOT_ID,
      message: `کاربر ${userId} از ${removedCount} گروه در این ربات حذف شد`
    });
  } catch (error) {
    console.error('❌ خطا در حذف کاربر از گروه‌ها:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/release-user', async (req, res) => {
  try {
    const { userId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log(`🔓 درخواست آزادسازی کاربر ${userId} از ربات تریگر`);
    
    const result = await releaseUserFromQuarantine(userId);
    
    res.status(200).json({ 
      success: result,
      botId: SELF_BOT_ID,
      message: result ? `کاربر ${userId} آزاد شد` : `خطا در آزادسازی کاربر ${userId}`
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================[ دستورات مدیریتی ]==================
bot.command('on', async (ctx) => {
  try {
    const access = await isOwnerOrCreator(ctx);
    if (!access.hasAccess) {
      ctx.reply(`❌ ${access.reason}`);
      return;
    }

    const chatId = ctx.chat.id.toString();

    if (!(await isBotAdmin(chatId))) {
      ctx.reply('❌ لطفاً ابتدا ربات را ادمین گروه کنید.');
      return;
    }

    const chatData = {
      chat_id: chatId,
      chat_title: ctx.chat.title,
      created_at: new Date().toISOString()
    };

    await supabase
      .from('allowed_chats')
      .upsert(chatData, { onConflict: 'chat_id' });

    cacheManager.setAllowedChat(chatId, chatData);
    cache.del('allowed_chats');

    console.log(`✅ ربات در گروه ${ctx.chat.title} (${chatId}) توسط ${access.reason} فعال شد`);
    ctx.reply('✅ ربات با موفقیت فعال شد! اکنون کاربران جدید به طور خودکار قرنطینه می‌شوند.');
  } catch (error) {
    console.error('❌ خطا در فعال‌سازی گروه:', error);
    ctx.reply('❌ خطا در فعال‌سازی گروه.');
  }
});

bot.command('off', async (ctx) => {
  try {
    const access = await isOwnerOrCreator(ctx);
    if (!access.hasAccess) {
      ctx.reply(`❌ ${access.reason}`);
      return;
    }

    const chatId = ctx.chat.id.toString();

    const { error: deleteError } = await supabase
      .from('allowed_chats')
      .delete()
      .eq('chat_id', chatId);

    if (deleteError) throw deleteError;

    cacheManager.setAllowedChat(chatId, null);
    cache.del('allowed_chats');

    console.log(`❌ ربات در گروه ${ctx.chat.title} (${chatId}) توسط ${access.reason} غیرفعال شد`);
    ctx.reply('✅ ربات با موفقیت غیرفعال شد! کاربران جدید قرنطینه نخواهند شد.');

    try {
      await ctx.leaveChat();
      console.log(`🚪 ربات از گروه ${chatId} خارج شد`);
    } catch (leaveError) {
      console.log('⚠️ خطا در خروج از گروه:', leaveError.message);
    }
    
  } catch (error) {
    console.error('❌ خطا در غیرفعال کردن ربات:', error);
    ctx.reply('❌ خطایی در غیرفعال کردن ربات رخ داد.');
  }
});

bot.command('status', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  
  const allowedChat = cacheManager.getAllowedChat(chatId);
  
  if (allowedChat) {
    ctx.reply('✅ ربات در این گروه فعال است.');
  } else {
    const { data } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (data) {
      cacheManager.setAllowedChat(chatId, data);
      ctx.reply('✅ ربات در این گروه فعال است.');
    } else {
      ctx.reply('❌ ربات در این گروه غیرفعال است.');
    }
  }
});

// ==================[ راه‌اندازی سرور ]==================
app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => {
  res.send(`
🤖 ربات قرنطینه ${SELF_BOT_ID} فعال است!
🔸 مالک: ${OWNER_ID}
🔸 سینک: ${SYNC_ENABLED ? 'فعال' : 'غیرفعال'}
🔸 ربات‌های هماهنگ: ${BOT_INSTANCES.length}
  `);
});

app.listen(PORT, () => {
  console.log(`✅ ربات قرنطینه ${SELF_BOT_ID} راه‌اندازی شد`);
  console.log(`👤 مالک ربات: ${OWNER_ID}`);
  console.log(`🔗 سینک: ${SYNC_ENABLED ? 'فعال' : 'غیرفعال'}`);
  console.log(`🤖 تعداد ربات‌های هماهنگ: ${BOT_INSTANCES.length}`);
  startAutoPing();
});

if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => console.log(`✅ Webhook تنظیم شد`))
    .catch(error => {
      console.error('❌ خطا در تنظیم Webhook:', error);
      bot.launch();
    });
} else {
  bot.launch();
}

cron.schedule('0 * * * *', () => {
  const stats = cache.getStats();
  console.log(`🧹 وضعیت کش: ${stats.keys} کلید`);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ خطای catch نشده:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ خطای مدیریت نشده:', error);
});
