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
    console.log('پینگ خودکار غیرفعال (محلی)');
    return;
  }

  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  console.log('راه اندازی پینگ خودکار هر 13:59 دقیقه...');

  const performPing = async () => {
    try {
      console.log('ارسال پینگ خودکار...');
      const response = await axios.get(`${selfUrl}/ping`, { 
        timeout: 10000 
      });
      console.log('پینگ موفق - ربات فعال');
    } catch (error) {
      console.error('پینگ ناموفق:', error.message);
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

const isBotAdmin = async (chatId) => {
  try {
    const self = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    return ['administrator', 'creator'].includes(self.status);
  } catch (error) {
    console.log(`خطا در بررسی ادمی�� بودن ربات در ${chatId}:`, error.message);
    return false;
  }
};

const getUserStatus = async (chatId, userId) => {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return member.status;
  } catch (error) {
    console.log(`خطا در دریافت وضعیت کاربر ${userId} در ${chatId}:`, error.message);
    return 'not_member';
  }
};

const removeUserFromChat = async (chatId, userId) => {
  try {
    console.log(`بررسی ادمین بودن ربات در گروه ${chatId}...`);
    
    if (!(await isBotAdmin(chatId))) {
      console.log(`ربات در گروه ${chatId} ادمین نیست`);
      return false;
    }
    
    console.log(`بررسی وضعیت کاربر ${userId} در گروه ${chatId}...`);
    const userStatus = await getUserStatus(chatId, userId);
    console.log(`وضعیت کاربر ${userId} در ${chatId}: ${userStatus}`);
    
    if (['left', 'kicked', 'not_member'].includes(userStatus)) {
      console.log(`کاربر ${userId} از قبل از گروه ${chatId} خارج شده است`);
      return true;
    }
    
    if (!['member', 'administrator', 'creator'].includes(userStatus)) {
      console.log(`کاربر ${userId} در گروه ${chatId} وضعیت غیرعادی دارد: ${userStatus}`);
      return true;
    }
    
    console.log(`شروع فرآیند حذف ک��ربر ${userId} از گروه ${chatId}...`);
    
    // ابتدا کاربر را بن می‌کنیم
    await bot.telegram.banChatMember(chatId, userId, {
      until_date: Math.floor(Date.now() / 1000) + 30
    });
    
    // سپس آنبن می‌کنیم تا بتواند دوباره جوین شود (فقط از گروه حذف شود)
    await bot.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
    
    console.log(`کاربر ${userId} با موفقیت از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    console.error(`خطا در حذف کاربر ${userId} از گروه ${chatId}:`, error.message);
    
    // بررسی نوع خطا
    if (error.response && error.response.error_code === 400) {
      console.log(`خطای 400: احتمالاً کاربر در گروه نیست یا از قبل حذف شده`);
      return true;
    }
    
    if (error.response && error.response.error_code === 403) {
      console.log(`خطای 403: ربات دسترسی لازم را ندارد`);
      return false;
    }
    
    return false;
  }
};

// ==================[ تابع اصلی حذف از گروه‌های دیگر ]==================
const removeUserFromAllOtherChats = async (currentChatId, userId, userName = 'ناشناس') => {
  try {
    console.log(`شروع بررسی حذف کاربر ${userName} (${userId}) ��ز سایر گروه ها...`);
    
    // دریافت تمام گروه‌های مجاز از دیتابیس
    const { data: allChats, error } = await supabase 
      .from('allowed_chats')
      .select('chat_id, chat_title');
    
    if (error) {
      console.error('خطا در دریافت لیست گروه ها از دیتابیس:', error);
      return;
    }
    
    if (!allChats || allChats.length === 0) {
      console.log('هیچ گروه فعال دیگری برای بررسی وجود ندارد');
      return;
    }
    
    console.log(`تعداد گروه های فعال: ${allChats.length}`);
    
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
      console.log(`بررسی گروه ${chat.chat_title} (${chatId})...`);
      
      try {
        // بررسی وضعیت کاربر در این گروه
        const userStatus = await getUserStatus(chatId, userId);
        console.log(`وضعیت کاربر در ${chat.chat_title}: ${userStatus}`);
        
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
          console.log(`کاربر در گروه ${chat.chat_title} نیست (وضعیت: ${userStatus})`);
          return { success: false, reason: 'not_member', chatId, chatTitle: chat.chat_title };
        }
      } catch (error) {
        console.error(`خطا در بررسی گروه ${chat.chat_title}:`, error.message);
        return { success: false, reason: 'error', chatId, chatTitle: chat.chat_title, error: error.message };
      }
    });
    
    // منتظر بمان تا تمام عملیات‌ها تمام شوند
    const results = await Promise.allSettled(removalPromises);
    
    console.log(`نتیجه نهایی: ${removedCount} کاربر از ${totalChecks} گروه بررسی شده حذف شد`);
    
    return {
      totalChecked: totalChecks,
      successfullyRemoved: removedCount,
      details: results
    };
    
  } catch (error) {
    console.error('خطای کلی در حذف از گروه های دیگر:', error);
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

    console.log(`بررسی کاربر ${userId} در سایر ربات ها...`);
    
    for (const botInstance of BOT_INSTANCES) {
      if (botInstance.id === SELF_BOT_ID) continue;
      
      try {
        console.log(`بررسی ربات ${botInstance.id}...`);
        let apiUrl = botInstance.url;
        if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
        
        const response = await axios.post(`${apiUrl.replace(/\/$/, '')}/api/check-quarantine`, {
          userId: userId,
          secretKey: botInstance.secretKey || API_SECRET_KEY
        }, { timeout: 5000 });

        if (response.data.isQuarantined) {
          console.log(`کاربر ${userId} در ربات ${botInstance.id} قرنطینه است`);
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
    
    console.log(`کاربر ${userId} در هیچ ربات دیگری قرنطینه نیست`);
    return { found: false };
  } catch (error) {
    console.error('خطا در بررسی سایر ربات ها:', error);
    return { found: false };
  }
};

const syncWithOtherBots = async (userId, chatId, action) => {
  try {
    if (!SYNC_ENABLED) return;

    console.log(`هماهنگی کاربر ${userId} با سایر ربات ها (عملیات: ${action})...`);
    
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
        
        console.log(`هماهنگی با ربات ${botInstance.id} موفقیت آمیز بود`);
      } catch (error) {
        console.log(`خطا در هماهنگی با ربات ${botInstance.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error('خطای کلی در هماهنگی:', error);
  }
};

// ==================[ تابع اصلی قرنطینه - اصلاح شده ]==================
const quarantineUser = async (ctx, user) => {
  try {
    console.log(`شروع فرآیند قرنطینه کاربر: ${user.first_name} (${user.id})`);
    
    const currentChatId = ctx.chat.id.toString();
    const currentChatTitle = ctx.chat.title || 'بدون عنوان';

    // 1. بررسی کاربر در ربات‌های دیگر
    console.log(`مرحله 1: بررسی کاربر در سایر ربات ها...`);
    const userInOtherBot = await checkUserInOtherBots(user.id);
    if (userInOtherBot.found) {
      console.log(`کاربر در ربات ${userInOtherBot.botId} قرنطینه است - حذف از گروه فعلی`);
      
      // حذف کاربر از گروه فعلی
      await removeUserFromChat(currentChatId, user.id);
      
      // پیام حذف نشود - فقط کاربر حذف شود
      return false;
    }

    // 2. بررسی وضعیت کاربر در دیتابیس
    console.log(`مرحله 2: بررسی وضعیت کاربر در دیتابیس...`);
    const { data: existingUser } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // اگر کاربر در گروه دیگری قرنطینه است
    if (existingUser && existingUser.is_quarantined && existingUser.current_chat_id !== currentChatId) {
      console.log(`کاربر در گروه ${existingUser.current_chat_id} قرنطینه است - حذف از گروه فعلی`);
      await removeUserFromChat(currentChatId, user.id);
      
      // پیام حذف نشود - فقط کاربر حذف شود
      return false;
    }

    // 3. ثبت کاربر در قرنطینه
    console.log(`مرحله 3: ثبت کاربر در دیتابیس...`);
    const { error: upsertError } = await supabase.from('quarantine_users').upsert({
      user_id: user.id,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    if (upsertError) {
      console.error('خطا در ثبت کاربر در دیتابیس:', upsertError);
      return false;
    }

    // 4. حذف کاربر از گروه‌های دیگر - این مهمترین بخش است
    console.log(`مرحله 4: حذف کاربر از سایر گروه ها...`);
    const removalResult = await removeUserFromAllOtherChats(currentChatId, user.id, user.first_name);
    
    if (removalResult && removalResult.successfullyRemoved > 0) {
      console.log(`کاربر از ${removalResult.successfullyRemoved} گروه دیگر حذف شد`);
    }

    // 5. هماهنگی با سایر ربات‌ها - اینجا باید به ربات‌های دیگر بگوید کاربر را حذف کنند
    console.log(`مرحله 5: هماهنگی با سایر ربات ها برای حذف کاربر...`);
    await syncWithOtherBots(user.id, currentChatId, 'remove_from_other_chats');

    console.log(`کاربر ${user.id} با موفقیت قرنطینه شد`);
    
    // پیام قرنطینه حذف شده - هیچ پیامی ارسال نمی‌شود
    
    return true;
    
  } catch (error) {
    console.error('خطای کلی در قرنطینه:', error);
    return false;
  }
};

// ==================[ تابع آزادسازی کاربر ]==================
const releaseUserFromQuarantine = async (userId) => {
  try {
    console.log(`شروع آزادسازی کاربر ${userId}...`);
    
    // بررسی ��ضعیت کاربر
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
      console.error(`خطا در آزادسازی دیتابیس:`, updateError);
      return false;
    }
    
    // پاک کردن کش
    cache.del(`quarantine:${userId}`);
    
    // هماهنگی با سایر ربات‌ها
    await syncWithOtherBots(userId, null, 'release');
    
    console.log(`کاربر ${userId} با موفقیت آزاد شد`);
    return true;
  } catch (error) {
    console.error(`خطای کلی در آزادسازی:`, error);
    return false;
  }
};

// ==================[ پردازش کاربران جدید ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    console.log(`دریافت کاربر ��دید در گروه ${ctx.chat.title} (${ctx.chat.id})`);
    
    // بررسی فعال بودن گروه
    const { data: allowedChat } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', ctx.chat.id.toString())
      .single();

    if (!allowedChat) {
      console.log(`گروه ${ctx.chat.id} فعال نیست - قرنطینه انجام نمی شود`);
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
    console.error('خطای کلی در پردازش کاربر جدید:', error);
  }
});

// ==================[ endpointهای API - اصلاح شده ]==================
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
    } else if (action === 'remove_from_other_chats') {
      // وقتی از ربات دیگر درخواست حذف کاربر می‌رسد
      console.log(`درخواست حذف کاربر ${userId} از گروه های این ربات`);
      
      // کاربر را از تمام گروه‌های این ربات به جز گروه فعلی حذف کن
      await removeUserFromAllOtherChats(chatId, userId, 'کاربر از ربات دیگر');
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
