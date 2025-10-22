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
const OWNER_ID = process.env.OWNER_ID;

// کش برای ذخیره وضعیت
const cache = new NodeCache({ stdTTL: 300, checkperiod: 600 });

// ==================[ پینگ خودکار ]==================
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) {
    console.log('پینگ خودکار غيرفعال (محلي)');
    return;
  }

  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  console.log('راه اندازي پينگ خودکار هر 13:59 دقيقه...');

  const performPing = async () => {
    try {
      console.log('ارسال پينگ خودکار...');
      const response = await axios.get(`${selfUrl}/ping`, { 
        timeout: 10000 
      });
      console.log('پينگ موفق - ربات فعال');
    } catch (error) {
      console.error('پينگ ناموفق:', error.message);
      setTimeout(performPing, 2 * 60 * 1000);
    }
  };

  setTimeout(performPing, 30000);
  setInterval(performPing, PING_INTERVAL);
};

// endpoint پینگ
app.get('/ping', (req, res) => {
  console.log('دریافت پینگ - ربات فعال است');
  res.status(200).json({
    status: 'active',
    botId: SELF_BOT_ID,
    timestamp: new Date().toISOString(),
    message: 'ربات قرنطینه فعال است'
  });
});

// ==================[ لاگینگ ]==================
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

// ==================[ توابع کمکی ]==================
const isOwner = (userId) => {
  if (!OWNER_ID) return false;
  return userId.toString().trim() === OWNER_ID.toString().trim();
};

const formatPersianDate = () => {
  const now = new Date();
  return new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(now);
};

const isBotAdmin = async (chatId) => {
  try {
    const self = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    return ['administrator', 'creator'].includes(self.status);
  } catch (error) {
    console.log(`خطا در بررسي ادمين بودن ربات در ${chatId}:`, error.message);
    return false;
  }
};

const getUserStatus = async (chatId, userId) => {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return member.status;
  } catch (error) {
    console.log(`خطا در دريافت وضعيت کاربر ${userId} در ${chatId}:`, error.message);
    return 'not_member';
  }
};

const removeUserFromChat = async (chatId, userId) => {
  try {
    console.log(`بررسي ادمين بودن ربات در گروه ${chatId}...`);
    
    if (!(await isBotAdmin(chatId))) {
      console.log(`ربات در گروه ${chatId} ادمين نيست`);
      return false;
    }
    
    console.log(`بررسي وضعيت کاربر ${userId} در گروه ${chatId}...`);
    const userStatus = await getUserStatus(chatId, userId);
    console.log(`وضعيت کاربر ${userId} در ${chatId}: ${userStatus}`);
    
    if (['left', 'kicked', 'not_member'].includes(userStatus)) {
      console.log(`کاربر ${userId} از قبل از گروه ${chatId} خارج شده است`);
      return true;
    }
    
    if (!['member', 'administrator', 'creator'].includes(userStatus)) {
      console.log(`کاربر ${userId} در گروه ${chatId} وضعيت غيرعادي دارد: ${userStatus}`);
      return true;
    }
    
    console.log(`شروع فرآيند حذف کاربر ${userId} از گروه ${chatId}...`);
    
    // ابتدا کاربر را بن می‌کنیم
    await bot.telegram.banChatMember(chatId, userId, {
      until_date: Math.floor(Date.now() / 1000) + 30
    });
    
    // سپس آنبن می‌کنیم تا بتواند دوباره جوین شود (فقط از گروه حذف شود)
    await bot.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
    
    console.log(`کاربر ${userId} با موفقيت از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    console.error(`خطا در حذف کاربر ${userId} از گروه ${chatId}:`, error.message);
    
    // بررسی نوع خطا
    if (error.response && error.response.error_code === 400) {
      console.log(`خطاي 400: احتمالا کاربر در گروه نيست يا از قبل حذف شده`);
      return true;
    }
    
    if (error.response && error.response.error_code === 403) {
      console.log(`خطاي 403: ربات دسترسي لازم را ندارد`);
      return false;
    }
    
    return false;
  }
};

// ==================[ ت��بع اصلی حذف از گروه‌های دیگر ]==================
const removeUserFromAllOtherChats = async (currentChatId, userId, userName = 'ناشناس') => {
  try {
    console.log(`شروع بررسي حذف کاربر ${userName} (${userId}) از ساير گروه ها...`);
    
    // دریافت تمام گروه‌های مجاز از دیتابیس
    const { data: allChats, error } = await supabase 
      .from('allowed_chats')
      .select('chat_id, chat_title');
    
    if (error) {
      console.error('خطا در دريافت ليست گروه ها از ديتابيس:', error);
      return;
    }
    
    if (!allChats || allChats.length === 0) {
      console.log('هيچ گروه فعال ديگري براي بررسي وجود ندارد');
      return;
    }
    
    console.log(`تعداد گروه هاي فعال: ${allChats.length}`);
    
    let removedCount = 0;
    let totalChecks = 0;
    
    // بررسی هر گروه به صورت موازی با محدودیت
    const removalPromises = allChats.map(async (chat) => {
      const chatId = chat.chat_id.toString();
      
      // اگر گروه فعلی باشد، رد شو
      if (chatId === currentChatId.toString()) {
        return { success: false, reason: 'current_chat' };
      }
      
      totalChecks++;
      console.log(`بررسي گروه ${chat.chat_title} (${chatId})...`);
      
      try {
        // بررسی وضعیت کاربر در این گروه
        const userStatus = await getUserStatus(chatId, userId);
        console.log(`وضعيت کاربر در ${chat.chat_title}: ${userStatus}`);
        
        // اگر کاربر در گروه است و می‌تواند حذف شود
        if (['member', 'administrator', 'restricted'].includes(userStatus)) {
          console.log(`کاربر در گروه ${chat.chat_title} عضو است - شروع حذف...`);
          const removalResult = await removeUserFromChat(chatId, userId);
          
          if (removalResult) {
            removedCount++;
            console.log(`کاربر از گروه ${chat.chat_title} حذف شد`);
            return { success: true, chatId, chatTitle: chat.chat_title };
          } else {
            console.log(`حذف کاربر از گروه ${chat.chat_title} ناموفق بود`);
            return { success: false, reason: 'removal_failed', chatId, chatTitle: chat.chat_title };
          }
        } else {
          console.log(`کاربر در گروه ${chat.chat_title} نيست (وضعيت: ${userStatus})`);
          return { success: false, reason: 'not_member', chatId, chatTitle: chat.chat_title };
        }
      } catch (error) {
        console.error(`خطا در بررسي گروه ${chat.chat_title}:`, error.message);
        return { success: false, reason: 'error', chatId, chatTitle: chat.chat_title, error: error.message };
      }
    });
    
    // منتظر بمان تا تمام عملیات‌ها تمام شوند
    const results = await Promise.allSettled(removalPromises);
    
    console.log(`نتيجه نهايي: ${removedCount} کاربر از ${totalChecks} گروه بررسي شده حذف شد`);
    
    return {
      totalChecked: totalChecks,
      successfullyRemoved: removedCount,
      details: results
    };
    
  } catch (error) {
    console.error('خطاي کلي در حذف از گروه هاي ديگر:', error);
    return {
      totalChecked: 0,
      successfullyRemoved: 0,
      error: error.message
    };
  }
};

// ==================[ توابع اصلی قرنطینه ]==================
const checkUserInOtherBots = async (userId) => {
  try {
    if (!SYNC_ENABLED) return { found: false };

    console.log(`بررسي کاربر ${userId} در ساير ربات ها...`);
    
    for (const botInstance of BOT_INSTANCES) {
      if (botInstance.id === SELF_BOT_ID) continue;
      
      try {
        console.log(`بررسي ربات ${botInstance.id}...`);
        let apiUrl = botInstance.url;
        if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
        
        const response = await axios.post(`${apiUrl.replace(/\/$/, '')}/api/check-quarantine`, {
          userId: userId,
          secretKey: botInstance.secretKey || API_SECRET_KEY
        }, { timeout: 5000 });

        if (response.data.isQuarantined) {
          console.log(`کاربر ${userId} در ربات ${botInstance.id} قرنطينه است`);
          return { 
            found: true, 
            botId: botInstance.id, 
            chatId: response.data.currentChatId 
          };
        }
      } catch (error) {
        console.log(`خطا در ارتباط با ربات ${botInstance.id}:`, error.message);
      }
    }
    
    console.log(`کاربر ${userId} در هيچ ربات ديگري قرنطينه نيست`);
    return { found: false };
  } catch (error) {
    console.error('خطا در بررسي ساير ربات ها:', error);
    return { found: false };
  }
};

const syncWithOtherBots = async (userId, chatId, action) => {
  try {
    if (!SYNC_ENABLED) return;

    console.log(`هماهنگي کاربر ${userId} با ساير ربات ها (عمليات: ${action})...`);
    
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
        
        console.log(`هماهنگي با ربات ${botInstance.id} موفقيت آميز بود`);
      } catch (error) {
        console.log(`خطا در هماهنگي با ربات ${botInstance.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error('خطاي کلي در هماهنگي:', error);
  }
};

// ==================[ تابع اصلی قرنطینه ]==================
const quarantineUser = async (ctx, user) => {
  try {
    console.log(`شروع فرآيند قرنطينه کاربر: ${user.first_name} (${user.id})`);
    
    const currentChatId = ctx.chat.id.toString();
    const currentChatTitle = ctx.chat.title || 'بدون عنوان';

    // 1. بررسی کاربر در ربات‌های دیگر
    console.log(`مرحله 1: بررسي کاربر در ساير ربات ها...`);
    const userInOtherBot = await checkUserInOtherBots(user.id);
    if (userInOtherBot.found) {
      console.log(`کاربر در ربات ${userInOtherBot.botId} قرنطينه است - حذف از گروه فعلي`);
      
      // حذف کاربر از گروه فعلی
      await removeUserFromChat(currentChatId, user.id);
      
      await ctx.reply(`کاربر ${user.first_name} در گروه ديگري قرنطينه است و نمي تواند به اين گروه بپيوندد.`);
      return false;
    }

    // 2. بررسی وضعیت کاربر در دیتابیس
    console.log(`مرحله 2: بررسي وضعيت کاربر در ديتابيس...`);
    const { data: existingUser } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // اگر کاربر در گروه دیگری قرنطینه است
    if (existingUser && existingUser.is_quarantined && existingUser.current_chat_id !== currentChatId) {
      console.log(`کاربر در گروه ${existingUser.current_chat_id} قرنطينه است - حذف از گروه فعلي`);
      await removeUserFromChat(currentChatId, user.id);
      
      await ctx.reply(`کاربر ${user.first_name} در گروه ديگري قرنطينه است و نمي تواند به اين گروه بپيوندد.`);
      return false;
    }

    // 3. ثبت کاربر در قرنطینه
    console.log(`مرحله 3: ثبت کاربر در ديتابيس...`);
    const { error: upsertError } = await supabase.from('quarantine_users').upsert({
      user_id: user.id,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    if (upsertError) {
      console.error('خطا در ثبت کاربر در ديتابيس:', upsertError);
      return false;
    }

    // 4. حذف کاربر از گروه‌های دیگر
    console.log(`مرحله 4: حذف کاربر از ساير گروه ها...`);
    const removalResult = await removeUserFromAllOtherChats(currentChatId, user.id, user.first_name);
    
    if (removalResult && removalResult.successfullyRemoved > 0) {
      console.log(`کاربر از ${removalResult.successfullyRemoved} گروه ديگر حذف شد`);
    }

    // 5. هماهنگی با سایر ربات‌ها
    console.log(`مرحله 5: هماهنگي با ساير ربات ها...`);
    await syncWithOtherBots(user.id, currentChatId, 'quarantine');

    console.log(`کاربر ${user.id} با موفقيت قرنطينه شد`);
    
    // اطلاع‌رسانی در گروه - خطای اصلی اینجا بود
    await ctx.reply(`کاربر ${user.first_name} (${user.username || 'بدون يوزرنيم') با موفقيت قرنطينه شد.\n\nاين کاربر از تمام گروه هاي ديگر حذف شد و فقط مي تواند در اين گروه فعاليت کند.`);
    
    return true;
    
  } catch (error) {
    console.error('خطاي کلي در قرنطينه:', error);
    
    try {
      await ctx.reply(`خطا در قرنطينه کاربر: ${error.message}`);
    } catch (replyError) {
      console.error('خطا در ارسال پيام خطا:', replyError);
    }
    
    return false;
  }
};

// ==================[ تابع آزادسازی کاربر ]==================
const releaseUserFromQuarantine = async (userId) => {
  try {
    console.log(`شروع آزادسازي کاربر ${userId}...`);
    
    // بررسی وضعیت کاربر
    const { data: existingUser } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!existingUser || !existingUser.is_quarantined) {
      console.log(`کاربر ${userId} از قبل آزاد است`);
      return true;
    }
    
    // آپدیت وضعیت کاربر
    const { error: updateError } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);
      
    if (updateError) {
      console.error(`خطا در آزادسازي ديتابيس:`, updateError);
      return false;
    }
    
    // پاک کردن کش
    cache.del(`quarantine:${userId}`);
    
    // هماهنگی با سایر ربات‌ها
    await syncWithOtherBots(userId, null, 'release');
    
    console.log(`کاربر ${userId} با موفقيت آزاد شد`);
    return true;
  } catch (error) {
    console.error(`خطاي کلي در آزادسازي:`, error);
    return false;
  }
};

// ==================[ پردازش کاربران جدید ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    console.log(`دریافت کاربر جدید در گروه ${ctx.chat.title} (${ctx.chat.id})`);
    
    // بررسی فعال بودن گروه
    const { data: allowedChat } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', ctx.chat.id.toString())
      .single();

    if (!allowedChat) {
      console.log(`گروه ${ctx.chat.id} فعال نیست - قرنطينه انجام نمي شود`);
      return;
    }

    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        console.log(`پردازش کاربر جدید: ${member.first_name} (${member.id})`);
        await quarantineUser(ctx, member);
      } else {
        console.log(`ربات ${member.first_name} نادیده گرفته شد`);
      }
    }
  } catch (error) {
    console.error('خطاي کلي در پردازش کاربر جدید:', error);
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
      currentChatId: user ? user.current_chat_id : null,
      username: user ? user.username : null,
      firstName: user ? user.first_name : null,
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

app.post('/api/release-user', async (req, res) => {
  try {
    const { userId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const success = await releaseUserFromQuarantine(userId);
    
    if (success) {
      res.status(200).json({ success: true });
    } else {
      res.status(500).json({ success: false });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================[ دستورات مدیریتی ]==================
bot.command('on', async (ctx) => {
  if (!ctx.message.chat.type.includes('group')) {
    ctx.reply('این دستور فقط در گروه ها کار می کند');
    return;
  }

  const chatId = ctx.chat.id.toString();

  if (!(await isBotAdmin(chatId))) {
    ctx.reply('ربات باید ادمین باشد');
    return;
  }

  // بررسی فعال بودن گروه
  const { data: existingChat } = await supabase
    .from('allowed_chats')
    .select('chat_id')
    .eq('chat_id', chatId)
    .single();

  if (existingChat) {
    ctx.reply('ربات قبلا فعال شده است');
    return;
  }

  // فعال‌سازی گروه
  await supabase.from('allowed_chats').insert({
    chat_id: chatId,
    chat_title: ctx.chat.title,
    created_at: new Date().toISOString()
  });

  ctx.reply('ربات فعال شد! کاربران جدید قرنطینه خواهند شد.');
});

bot.command('off', async (ctx) => {
  if (!ctx.message.chat.type.includes('group')) {
    ctx.reply('این دستور فقط در گروه ها کار می کند');
    return;
  }

  const chatId = ctx.chat.id.toString();

  // غیرفعال‌سازی گروه
  await supabase
    .from('allowed_chats')
    .delete()
    .eq('chat_id', chatId);

  ctx.reply('ربات غیرفعال شد!');
});

bot.command('free', async (ctx) => {
  if (!ctx.message.reply_to_message) {
    ctx.reply('روی پیام کاربر ریپلای کنید');
    return;
  }

  const targetUser = ctx.message.reply_to_message.from;
  if (targetUser.is_bot) {
    ctx.reply('نمی توان ربات ها را آزاد کرد');
    return;
  }

  const success = await releaseUserFromQuarantine(targetUser.id);

  if (success) {
    ctx.reply(`کاربر ${targetUser.first_name} آزاد شد`);
  } else {
    ctx.reply('خطا در آزادسازی کاربر');
  }
});

bot.command('status', async (ctx) => {
  if (!ctx.message.chat.type.includes('group')) {
    ctx.reply('این دستور فقط در گروه ها کار می کند');
    return;
  }

  const chatId = ctx.chat.id.toString();

  const { data: allowedChat } = await supabase
    .from('allowed_chats')
    .select('chat_id')
    .eq('chat_id', chatId)
    .single();

  if (allowedChat) {
    ctx.reply('ربات فعال است - کاربران جدید قرنطینه می شوند');
  } else {
    ctx.reply('ربات غیرفعال است - از /on استفاده کنید');
  }
});

// ==================[ بررسی انقضای قرنطینه ]==================
const checkQuarantineExpiry = async () => {
  try {
    const { data: expiredUsers } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('is_quarantined', true)
      .lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    
    if (expiredUsers && expiredUsers.length > 0) {
      for (const user of expiredUsers) {
        await releaseUserFromQuarantine(user.user_id);
      }
    }
  } catch (error) {
    console.error('خطا در بررسی انقضا:', error);
  }
};

// ==================[ راه‌اندازی سرور ]==================
app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => res.send('ربات قرنطینه فعال است!'));

app.listen(PORT, () => {
  console.log(`ربات قرنطینه ${SELF_BOT_ID} راه اندازی شد`);
  console.log(`هماهنگی: ${SYNC_ENABLED ? 'فعال' : 'غیرفعال'}`);
  console.log(`ربات های متصل: ${BOT_INSTANCES.length}`);
  
  startAutoPing();
});

// کرون جاب برای بررسی انقضا
cron.schedule('0 */6 * * *', () => checkQuarantineExpiry());

// فعال‌سازی وب‌هوک
if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => console.log('وب هوک تنظیم شد'))
    .catch(error => {
      console.error('خطا در وب هوک:', error);
      bot.launch().then(() => console.log('ربات با پولینگ راه اندازی شد'));
    });
} else {
  bot.launch().then(() => console.log('ربات با پولینگ راه اندازی شد'));
}
