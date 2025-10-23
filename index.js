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
  stdTTL: 900,        // 15 دقیقه
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

// ==================[ توابع مالکیت و دسترسی - کاملاً اصلاح شده ]==================
const isOwner = (userId) => {
  if (!OWNER_ID) {
    console.log('⚠️ OWNER_ID تنظیم نشده است');
    return false;
  }
  
  const isOwner = userId === OWNER_ID;
  console.log(`🔍 بررسی مالکیت: ${userId} == ${OWNER_ID} = ${isOwner}`);
  return isOwner;
};

const isOwnerOrCreator = async (ctx) => {
  try {
    const userId = ctx.from.id;
    
    // مالک اصلی
    if (isOwner(userId)) {
      return { hasAccess: true, isOwner: true, reason: 'مالک ربات' };
    }
    
    if (ctx.chat.type === 'private') {
      return { hasAccess: false, reason: 'این دستور فقط در گروه کار می‌کند' };
    }

    // بررسی سازنده گروه
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

// ==================[ کش پیشرفته برای داده‌های پرتکرار ]==================
const cacheManager = {
  // کش برای کاربران
  setUser: (userId, userData) => {
    cache.set(`user:${userId}`, userData, 300); // 5 دقیقه
  },
  
  getUser: (userId) => {
    return cache.get(`user:${userId}`);
  },
  
  // کش برای گروه‌های فعال
  setAllowedChat: (chatId, chatData) => {
    cache.set(`chat:${chatId}`, chatData, 600); // 10 دقیقه
  },
  
  getAllowedChat: (chatId) => {
    return cache.get(`chat:${chatId}`);
  },
  
  // کش برای وضعیت ادمین
  setAdminStatus: (chatId, userId, isAdmin) => {
    cache.set(`admin:${chatId}:${userId}`, isAdmin, 300); // 5 دقیقه
  },
  
  getAdminStatus: (chatId, userId) => {
    return cache.get(`admin:${chatId}:${userId}`);
  },
  
  // کش برای نتایج بررسی سایر ربات‌ها
  setBotCheckResult: (userId, result) => {
    cache.set(`botcheck:${userId}`, result, 180); // 3 دقیقه
  },
  
  getBotCheckResult: (userId) => {
    return cache.get(`botcheck:${userId}`);
  },
  
  // پاک کردن کش مربوط به یک کاربر
  invalidateUser: (userId) => {
    cache.del(`user:${userId}`);
    cache.del(`botcheck:${userId}`);
  }
};

// Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

// ==================[ توابع بهینه‌شده با کش ]==================
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

// ==================[ توابع اصلی با بهینه‌سازی Egress ]==================
const checkUserInAllOtherBots = async (userId) => {
  try {
    // اول از کش چک کن
    const cachedResult = cacheManager.getBotCheckResult(userId);
    if (cachedResult) {
      console.log(`🔍 استفاده از کش برای بررسی کاربر ${userId}`);
      return cachedResult;
    }

    if (!SYNC_ENABLED || BOT_INSTANCES.length === 0) {
      return { found: false, botId: null, chatId: null };
    }

    const otherBots = BOT_INSTANCES.filter(bot => bot.id !== SELF_BOT_ID && bot.type === 'quarantine');
    
    if (otherBots.length === 0) {
      return { found: false, botId: null, chatId: null };
    }

    // از Promise.allSettled استفاده کن تا اگر بعضی ربات‌ها جواب ندادن، بقیه کار کنن
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
        // خطا رو لاگ نکن تا Egress کمتری مصرف بشه
      }
      return null;
    });

    const results = await Promise.allSettled(promises);
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value !== null) {
        // نتیجه رو در کش ذخیره کن
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

    // اطلاع‌رسانی غیرهمزمان - منتظر جواب نباش
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
    // خطای اصلی رو لاگ کن
    console.error('❌ خطا در اطلاع‌رسانی به ربات‌ها:', error);
  }
};

// ==================[ تابع اصلی قرنطینه - بهینه‌شده ]==================
const quarantineUser = async (ctx, user) => {
  try {
    const currentChatId = ctx.chat.id.toString();
    const userName = user.first_name || 'ناشناس';

    // 🔍 بررسی کش برای کاربر
    const cachedUser = cacheManager.getUser(user.id);
    if (cachedUser && cachedUser.is_quarantined && cachedUser.current_chat_id !== currentChatId) {
      console.log(`🚫 کاربر در کش پیدا شد - حذف از گروه فعلی`);
      await removeUserFromChat(currentChatId, user.id);
      return false;
    }

    // 🔍 بررسی سایر ربات‌ها
    const userInOtherBot = await checkUserInAllOtherBots(user.id);
    if (userInOtherBot.found) {
      console.log(`🚫 کاربر در ربات ${userInOtherBot.botId} قرنطینه است`);
      await removeUserFromChat(currentChatId, user.id);
      return false;
    }

    // 🔍 بررسی دیتابیس (فقط اگر در کش نبود)
    const { data: existingUser } = await supabase
      .from('quarantine_users')
      .select('user_id, is_quarantined, current_chat_id')
      .eq('user_id', user.id)
      .single();

    if (existingUser && existingUser.is_quarantined && existingUser.current_chat_id !== currentChatId) {
      console.log(`🚫 کاربر در دیتابیس پیدا شد - حذف از گروه فعلی`);
      // در کش ذخیره کن
      cacheManager.setUser(user.id, existingUser);
      await removeUserFromChat(currentChatId, user.id);
      return false;
    }

    // ✅ قرنطینه کاربر
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

    // در کش ذخیره کن
    cacheManager.setUser(user.id, userData);

    // 🗑️ حذف از گروه‌های محلی
    await removeUserFromLocalChats(currentChatId, user.id);

    // 📢 اطلاع به سایر ربات‌ها
    await notifyAllOtherBots(user.id, currentChatId, 'quarantine');

    console.log(`✅ کاربر ${user.id} با موفقیت قرنطینه شد`);
    return true;
    
  } catch (error) {
    console.error('❌ خطا در فرآیند قرنطینه:', error);
    return false;
  }
};

const removeUserFromLocalChats = async (currentChatId, userId) => {
  try {
    // اول از کش گروه‌ها رو بگیر
    let allChats = cache.get('allowed_chats');
    
    if (!allChats) {
      // اگر در کش نبود، از دیتابیس بگیر و در کش ذخیره کن
      const { data } = await supabase.from('allowed_chats').select('chat_id, chat_title');
      if (data) {
        allChats = data;
        cache.set('allowed_chats', data, 300); // 5 دقیقه
      } else {
        return;
      }
    }

    let removedCount = 0;
    for (const chat of allChats) {
      const chatIdStr = chat.chat_id.toString();
      if (chatIdStr === currentChatId.toString()) continue;

      try {
        const userStatus = await getUserStatus(chat.chat_id, userId);
        if (userStatus && !['left', 'kicked', 'not_member'].includes(userStatus)) {
          const removed = await removeUserFromChat(chat.chat_id, userId);
          if (removed) removedCount++;
        }
      } catch (error) {
        // کاربر در گروه نیست
      }
    }
    
    if (removedCount > 0) {
      console.log(`✅ کاربر ${userId} از ${removedCount} گروه محلی حذف شد`);
    }
  } catch (error) {
    console.error('❌ خطا در حذف از گروه‌های محلی:', error);
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
    
    // کش رو پاک کن
    cacheManager.invalidateUser(userId);
    
    // اطلاع به سایر ربات‌ها
    await notifyAllOtherBots(userId, null, 'release');
    
    console.log(`✅ کاربر ${userId} از قرنطینه آزاد شد`);
    return true;
  } catch (error) {
    console.error(`❌ خطا در آزادسازی کاربر ${userId}:`, error);
    return false;
  }
};

// ==================[ پردازش اعضای جدید - با چک مالکیت ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    // اگر ربات اضافه شده باشد
    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot && member.id === ctx.botInfo.id) {
        console.log(`🤖 ربات به گروه ${ctx.chat.title} (${ctx.chat.id}) اضافه شد`);
        
        // بررسی مالکیت کاربری که ربات را اضافه کرده
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

// ==================[ endpointهای API - بهینه‌شده ]==================
app.post('/api/check-quarantine', async (req, res) => {
  try {
    const { userId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // اول از کش چک کن
    const cachedUser = cacheManager.getUser(userId);
    if (cachedUser) {
      return res.status(200).json({ 
        isQuarantined: cachedUser.is_quarantined,
        currentChatId: cachedUser.current_chat_id,
        botId: SELF_BOT_ID,
        source: 'cache'
      });
    }
    
    // اگر در کش نبود، از دیتابیس بگیر
    const { data: user } = await supabase
      .from('quarantine_users')
      .select('user_id, is_quarantined, current_chat_id')
      .eq('user_id', userId)
      .single();
      
    if (user) {
      // در کش ذخیره کن
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

// ==================[ endpoint آزادسازی کاربر ]==================
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

// ==================[ دستورات مدیریتی - با چک مالکیت کامل ]==================
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

    // در کش ذخیره کن
    cacheManager.setAllowedChat(chatId, chatData);
    cache.del('allowed_chats'); // کش لیست گروه‌ها رو پاک کن

    console.log(`✅ ربات در گروه ${ctx.chat.title} (${chatId}) توسط ${access.reason} فعال شد`);
    ctx.reply('✅ ربات با موفقیت فعال شد! اکنون کاربران جدید به طور خودکار قرنطینه می‌شوند.');
  } catch (error) {
    console.error('❌ خطا در فعال‌سازی گروه:', error);
    ctx.reply('❌ خطا در فعال‌سازی گروه.');
  }
});

// ==================[ دستور /off - کاملاً جدید ]==================
bot.command('off', async (ctx) => {
  try {
    const access = await isOwnerOrCreator(ctx);
    if (!access.hasAccess) {
      ctx.reply(`❌ ${access.reason}`);
      return;
    }

    const chatId = ctx.chat.id.toString();

    // حذف گروه از دیتابیس
    const { error: deleteError } = await supabase
      .from('allowed_chats')
      .delete()
      .eq('chat_id', chatId);

    if (deleteError) throw deleteError;

    // پاک کردن کش
    cacheManager.setAllowedChat(chatId, null);
    cache.del('allowed_chats');

    console.log(`❌ ربات در گروه ${ctx.chat.title} (${chatId}) توسط ${access.reason} غیرفعال شد`);
    ctx.reply('✅ ربات با موفقیت غیرفعال شد! کاربران جدید قرنطینه نخواهند شد.');

    // خروج از گروه
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
  
  // از کش چک کن
  const allowedChat = cacheManager.getAllowedChat(chatId);
  
  if (allowedChat) {
    ctx.reply('✅ ربات در این گروه فعال است.');
  } else {
    // اگر در کش نبود، از دیتابیس چک کن
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

// ==================[ دستور اطلاعات ربات ]==================
bot.command('info', async (ctx) => {
  try {
    const access = await isOwnerOrCreator(ctx);
    
    if (!access.hasAccess && !isOwner(ctx.from.id)) {
      ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
      return;
    }

    const stats = cache.getStats();
    const chatId = ctx.chat.id.toString();
    const allowedChat = cacheManager.getAllowedChat(chatId);
    
    let infoText = `🤖 اطلاعات ربات قرنطینه\n\n`;
    infoText += `🔸 شناسه ربات: ${SELF_BOT_ID}\n`;
    infoText += `🔸 مالک ربات: ${OWNER_ID}\n`;
    infoText += `🔸 وضعیت سینک: ${SYNC_ENABLED ? 'فعال' : 'غیرفعال'}\n`;
    infoText += `🔸 تعداد کش: ${stats.keys} کلید\n`;
    infoText += `🔸 وضعیت گروه: ${allowedChat ? 'فعال' : 'غیرفعال'}\n`;
    infoText += `🔸 تعداد ربات‌های هماهنگ: ${BOT_INSTANCES.length}\n`;

    ctx.reply(infoText);
  } catch (error) {
    console.error('❌ خطا در دستور info:', error);
    ctx.reply('❌ خطا در دریافت اطلاعات ربات.');
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
  startAutoPing();
});

// فعال سازی وب هوک
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

// پاک‌سازی کش‌های قدیمی هر 1 ساعت
cron.schedule('0 * * * *', () => {
  const stats = cache.getStats();
  console.log(`🧹 وضعیت کش: ${stats.keys} کلید`);
});

// مدیریت خطاهای catch نشده
process.on('unhandledRejection', (error) => {
  console.error('❌ خطای catch نشده:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ خطای مدیریت نشده:', error);
});
