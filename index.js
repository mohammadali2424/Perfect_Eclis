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

// کش فوق بهینه
const cache = new NodeCache({ 
  stdTTL: 1800,
  checkperiod: 600,
  maxKeys: 5000,
  useClones: false
});

// ==================[ پینگ بهینه ]==================
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) return;
  
  const PING_INTERVAL = 14 * 60 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  const performPing = async () => {
    try {
      await axios.head(`${selfUrl}/ping`, { timeout: 5000 });
    } catch (error) {
      setTimeout(performPing, 2 * 60 * 1000);
    }
  };

  setTimeout(performPing, 45000);
  setInterval(performPing, PING_INTERVAL);
};

app.head('/ping', (req, res) => res.status(200).end());
app.get('/ping', (req, res) => {
  res.status(200).json({ status: 'active', botId: SELF_BOT_ID });
});

// ==================[ توابع مالکیت و دسترسی ]==================
const isOwner = (userId) => {
  if (!OWNER_ID) return false;
  return userId === OWNER_ID;
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
    return { hasAccess: false, reason: 'خطا در بررسی دسترسی' };
  }
};

// ==================[ کش پیشرفته ]==================
const cacheManager = {
  setUser: (userId, userData) => {
    cache.set(`user:${userId}`, userData, 600);
  },
  
  getUser: (userId) => {
    return cache.get(`user:${userId}`);
  },
  
  setAllowedChat: (chatId, chatData) => {
    cache.set(`chat:${chatId}`, chatData, 900);
  },
  
  getAllowedChat: (chatId) => {
    return cache.get(`chat:${chatId}`);
  },
  
  setAdminStatus: (chatId, userId, isAdmin) => {
    cache.set(`admin:${chatId}:${userId}`, isAdmin, 600);
  },
  
  getAdminStatus: (chatId, userId) => {
    return cache.get(`admin:${chatId}:${userId}`);
  },
  
  setBotCheckResult: (userId, result) => {
    cache.set(`botcheck:${userId}`, result, 300);
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

// ==================[ توابع اصلی - فوق بهینه ]==================
const isBotAdmin = async (chatId) => {
  try {
    const cacheKey = `botadmin:${chatId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    const self = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    const isAdmin = ['administrator', 'creator'].includes(self.status);
    
    cache.set(cacheKey, isAdmin, 600);
    return isAdmin;
  } catch (error) {
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
      return false;
    }
    
    const userStatus = await getUserStatus(chatId, userId);
    if (['left', 'kicked', 'not_member'].includes(userStatus)) {
      return true;
    }
    
    if (userStatus === 'creator') {
      return false;
    }
    
    await bot.telegram.banChatMember(chatId, userId, {
      until_date: Math.floor(Date.now() / 1000) + 30
    });
    
    await bot.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
    return true;
  } catch (error) {
    return false;
  }
};

// ==================[ تابع آزادسازی کاربر - کاملاً اصلاح شده ]==================
const releaseUserFromQuarantine = async (userId) => {
  try {
    console.log(`🔓 شروع آزادسازی کاربر ${userId} از قرنطینه`);

    // به روزرسانی وضعیت در دیتابیس
    const { error: updateError } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error(`❌ خطا در به‌روزرسانی دیتابیس:`, updateError);
      return false;
    }
    
    // پاک کردن کش کاربر
    cacheManager.invalidateUser(userId);
    
    // اطلاع به سایر ربات‌های قرنطینه
    if (SYNC_ENABLED) {
      const otherBots = BOT_INSTANCES.filter(bot => bot.id !== SELF_BOT_ID && bot.type === 'quarantine');
      
      otherBots.forEach(async (botInstance) => {
        try {
          let apiUrl = botInstance.url;
          if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
          
          await axios.post(`${apiUrl}/api/sync-user`, {
            u: userId,
            a: 'release',
            s: botInstance.secretKey || API_SECRET_KEY,
            b: SELF_BOT_ID
          }, { 
            timeout: 5000,
            headers: { 'X-Compressed': 'true' }
          });
        } catch (error) {
          // بدون لاگ برای کاهش Egress
        }
      });
    }
    
    console.log(`✅ کاربر ${userId} با موفقیت از قرنطینه آزاد شد`);
    return true;
  } catch (error) {
    console.error(`❌ خطا در آزادسازی کاربر ${userId}:`, error);
    return false;
  }
};

// ==================[ توابع حذف کاربر - بهینه‌شده ]==================
const removeUserFromLocalChats = async (currentChatId, userId) => {
  try {
    let allChats = cache.get('allowed_chats');
    
    if (!allChats) {
      const { data } = await supabase.from('allowed_chats').select('chat_id, chat_title');
      if (data) {
        allChats = data;
        cache.set('allowed_chats', data, 600);
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
        // کاربر در گروه نیست
      }
    }
    
    return removedCount;
  } catch (error) {
    return 0;
  }
};

const removeUserFromOtherBots = async (currentChatId, userId) => {
  try {
    if (!SYNC_ENABLED) return 0;

    const otherBots = BOT_INSTANCES.filter(bot => bot.id !== SELF_BOT_ID);
    if (otherBots.length === 0) return 0;

    let totalRemoved = 0;
    
    for (const botInstance of otherBots) {
      try {
        let apiUrl = botInstance.url;
        if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
        
        const response = await axios.post(`${apiUrl}/api/remove-user-from-all-chats`, {
          u: userId,
          c: currentChatId,
          s: botInstance.secretKey || API_SECRET_KEY,
          b: SELF_BOT_ID
        }, { 
          timeout: 8000,
          headers: { 'X-Compressed': 'true' }
        });

        if (response.data && response.data.s) {
          totalRemoved += response.data.r || 0;
        }
      } catch (error) {
        // بدون لاگ برای کاهش Egress
      }
    }

    return totalRemoved;
  } catch (error) {
    return 0;
  }
};

// ==================[ تابع اصلی قرنطینه - کاملاً بازنویسی شده ]==================
const quarantineUser = async (ctx, user) => {
  try {
    const currentChatId = ctx.chat.id.toString();
    const userId = user.id;

    console.log(`🔍 شروع فرآیند قرنطینه برای کاربر ${userId} در گروه ${currentChatId}`);

    // 1. بررسی کش
    const cachedUser = cacheManager.getUser(userId);
    if (cachedUser && cachedUser.is_quarantined && cachedUser.current_chat_id !== currentChatId) {
      await removeUserFromChat(currentChatId, userId);
      return false;
    }

    // 2. بررسی سایر ربات‌ها
    if (SYNC_ENABLED) {
      const otherBots = BOT_INSTANCES.filter(bot => bot.id !== SELF_BOT_ID && bot.type === 'quarantine');
      
      for (const botInstance of otherBots) {
        try {
          let apiUrl = botInstance.url;
          if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
          
          const response = await axios.post(`${apiUrl}/api/check-quarantine`, {
            u: userId,
            s: botInstance.secretKey || API_SECRET_KEY,
            b: SELF_BOT_ID
          }, { 
            timeout: 6000,
            headers: { 'X-Compressed': 'true' }
          });

          if (response.data && response.data.q) {
            await removeUserFromChat(currentChatId, userId);
            return false;
          }
        } catch (error) {
          // ادامه بررسی سایر ربات‌ها
        }
      }
    }

    // 3. بررسی دیتابیس
    const { data: existingUser } = await supabase
      .from('quarantine_users')
      .select('user_id, is_quarantined, current_chat_id')
      .eq('user_id', userId)
      .single();

    if (existingUser && existingUser.is_quarantined && existingUser.current_chat_id !== currentChatId) {
      cacheManager.setUser(userId, existingUser);
      await removeUserFromChat(currentChatId, userId);
      return false;
    }

    // 4. قرنطینه کاربر
    const userData = {
      user_id: userId,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId,
      updated_at: new Date().toISOString()
    };

    await supabase.from('quarantine_users').upsert(userData, { 
      onConflict: 'user_id' 
    });

    cacheManager.setUser(userId, userData);

    // 5. حذف از تمام گروه‌های دیگر
    const localRemoved = await removeUserFromLocalChats(currentChatId, userId);
    const otherBotsRemoved = await removeUserFromOtherBots(currentChatId, userId);
    
    console.log(`✅ کاربر ${userId} قرنطینه شد - حذف از ${localRemoved + otherBotsRemoved} گروه`);
    return true;
    
  } catch (error) {
    console.error('❌ خطا در فرآیند قرنطینه:', error);
    return false;
  }
};

// ==================[ پردازش اعضای جدید ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    // اگر ربات اضافه شده باشد
    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot && member.id === ctx.botInfo.id) {
        const addedBy = ctx.message.from;
        if (!isOwner(addedBy.id)) {
          await ctx.reply('❌ فقط مالک ربات می‌تواند ربات را به گروه اضافه کند.');
          await ctx.leaveChat();
          return;
        }
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
        return;
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

// ==================[ endpointهای API - با داده فشرده ]==================
app.post('/api/check-quarantine', async (req, res) => {
  try {
    const { s: secretKey, u: userId } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ e: 'Unauthorized' });
    }
    
    const cachedUser = cacheManager.getUser(userId);
    if (cachedUser) {
      return res.status(200).json({ 
        q: cachedUser.is_quarantined, // isQuarantined
        c: cachedUser.current_chat_id, // currentChatId
        b: SELF_BOT_ID
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
      q: user ? user.is_quarantined : false,
      c: user ? user.current_chat_id : null,
      b: SELF_BOT_ID
    });
  } catch (error) {
    res.status(500).json({ e: 'Internal server error' });
  }
});

app.post('/api/sync-user', async (req, res) => {
  try {
    const { u: userId, c: chatId, a: action, s: secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ e: 'Unauthorized' });
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
    
    res.status(200).json({ s: true, b: SELF_BOT_ID });
  } catch (error) {
    res.status(500).json({ e: 'Internal server error' });
  }
});

app.post('/api/remove-user-from-all-chats', async (req, res) => {
  try {
    const { u: userId, c: currentChatId, s: secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ e: 'Unauthorized' });
    }
    
    const removedCount = await removeUserFromLocalChats(currentChatId, userId);
    
    res.status(200).json({ 
      s: true,
      r: removedCount, // removedCount
      b: SELF_BOT_ID
    });
  } catch (error) {
    res.status(500).json({ e: 'Internal server error' });
  }
});

// ==================[ endpoint آزادسازی کاربر - کاملاً اصلاح شده ]==================
app.post('/api/release-user', async (req, res) => {
  try {
    const { u: userId, s: secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ e: 'Unauthorized' });
    }
    
    console.log(`🔓 دریافت درخواست آزادسازی کاربر ${userId} از ربات تریگر`);
    
    const result = await releaseUserFromQuarantine(userId);
    
    res.status(200).json({ 
      s: result, // success
      b: SELF_BOT_ID,
      m: result ? `کاربر ${userId} آزاد شد` : `خطا در آزادسازی`
    });
  } catch (error) {
    console.error('❌ خطا در endpoint آزادسازی:', error);
    res.status(500).json({ e: 'Internal server error' });
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

    ctx.reply('✅ ربات با موفقیت فعال شد! اکنون کاربران جدید به طور خودکار قرنطینه می‌شوند.');
  } catch (error) {
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

    ctx.reply('✅ ربات با موفقیت غیرفعال شد! کاربران جدید قرنطینه نخواهند شد.');

    try {
      await ctx.leaveChat();
    } catch (leaveError) {
      // بدون لاگ
    }
  } catch (error) {
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
  res.send(`🤖 ربات قرنطینه ${SELF_BOT_ID} فعال - مالک: ${OWNER_ID}`);
});

app.listen(PORT, () => {
  console.log(`✅ ربات قرنطینه ${SELF_BOT_ID} راه‌اندازی شد`);
  startAutoPing();
});

if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => console.log(`✅ Webhook تنظیم شد`))
    .catch(error => {
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
