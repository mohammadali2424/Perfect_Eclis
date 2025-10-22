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
    console.log('🚫 پینگ خودکار غیرفعال (محلی)');
    return;
  }

  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  console.log('🔁 راه‌اندازی پینگ خودکار هر 13:59 دقیقه...');

  const performPing = async () => {
    try {
      console.log('🏓 ارسال پینگ خودکار برای جلوگیری از خوابیدن...');
      const response = await axios.get(`${selfUrl}/ping`, { 
        timeout: 10000 
      });
      console.log('✅ پینگ موفق - ربات فعال می‌ماند');
    } catch (error) {
      console.error('❌ پینگ ناموفق:', error.message);
      setTimeout(performPing, 2 * 60 * 1000);
    }
  };

  setTimeout(performPing, 30000);
  setInterval(performPing, PING_INTERVAL);
};

// endpoint پینگ
app.get('/ping', (req, res) => {
  console.log('🏓 دریافت پینگ - ربات فعال است');
  res.status(200).json({
    status: 'active',
    botId: SELF_BOT_ID,
    timestamp: new Date().toISOString(),
    message: 'ربات قرنطینه فعال و بیدار است 🚀'
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
    return false;
  }
};

const getUserStatus = async (chatId, userId) => {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return member.status;
  } catch (error) {
    return 'not_member';
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

// ==================[ توابع اصلی قرنطینه ]==================
const checkUserInOtherBots = async (userId) => {
  try {
    if (!SYNC_ENABLED) return { found: false };

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
  } catch (error) {
    return { found: false };
  }
};

const removeUserFromAllOtherChats = async (currentChatId, userId, userName = 'ناشناس') => {
  try {
    const { data: allChats } = await supabase.from('allowed_chats').select('chat_id, chat_title');
    if (!allChats) return;

    for (const chat of allChats) {
      if (chat.chat_id.toString() === currentChatId.toString()) continue;
      
      try {
        const userStatus = await getUserStatus(chat.chat_id, userId);
        if (['member', 'administrator'].includes(userStatus)) {
          await removeUserFromChat(chat.chat_id, userId);
        }
      } catch (error) {
        // کاربر در گروه نیست
      }
    }
  } catch (error) {
    console.error('❌ خطا در حذف از گروه‌های دیگر:', error);
  }
};

const syncWithOtherBots = async (userId, chatId, action) => {
  try {
    if (!SYNC_ENABLED) return;

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
  } catch (error) {
    console.error('❌ خطا در هماهنگی:', error);
  }
};

// ==================[ تابع اصلی قرنطینه - منطق کامل ]==================
const quarantineUser = async (ctx, user) => {
  try {
    console.log(`🔒 شروع قرنطینه کاربر: ${user.first_name} (${user.id})`);
    
    const currentChatId = ctx.chat.id.toString();
    const currentChatTitle = ctx.chat.title || 'بدون عنوان';

    // 1. بررسی کاربر در ربات‌های دیگر
    const userInOtherBot = await checkUserInOtherBots(user.id);
    if (userInOtherBot.found) {
      console.log(`🚫 کاربر در ربات ${userInOtherBot.botId} قرنطینه است`);
      
      // حذف کاربر از گروه فعلی
      await removeUserFromChat(currentChatId, user.id);
      return false;
    }

    // 2. بررسی وضعیت کاربر در دیتابیس
    const { data: existingUser } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // اگر کاربر در گروه دیگری قرنطینه است
    if (existingUser && existingUser.is_quarantined && existingUser.current_chat_id !== currentChatId) {
      console.log(`🚫 کاربر در گروه ${existingUser.current_chat_id} قرنطینه است`);
      await removeUserFromChat(currentChatId, user.id);
      return false;
    }

    // 3. ثبت کاربر در قرنطینه
    await supabase.from('quarantine_users').upsert({
      user_id: user.id,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    // 4. حذف کاربر از گروه‌های دیگر
    await removeUserFromAllOtherChats(currentChatId, user.id, user.first_name);

    // 5. هماهنگی با سایر ربات‌ها
    await syncWithOtherBots(user.id, currentChatId, 'quarantine');

    console.log(`✅ کاربر ${user.id} قرنطینه شد`);
    return true;
    
  } catch (error) {
    console.error('❌ خطا در قرنطینه:', error);
    return false;
  }
};

// ==================[ تابع آزادسازی کاربر - کامل ]==================
const releaseUserFromQuarantine = async (userId) => {
  try {
    console.log(`🔄 آزادسازی کاربر ${userId}...`);
    
    // بررسی وضعیت کاربر
    const { data: existingUser } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!existingUser || !existingUser.is_quarantined) {
      console.log(`ℹ️ کاربر ${userId} از قبل آزاد است`);
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
      console.error(`❌ خطا در آزادسازی:`, updateError);
      return false;
    }
    
    // پاک کردن کش
    cache.del(`quarantine:${userId}`);
    
    // هماهنگی با سایر ربات‌ها
    await syncWithOtherBots(userId, null, 'release');
    
    console.log(`✅ کاربر ${userId} آزاد شد`);
    return true;
  } catch (error) {
    console.error(`❌ خطا در آزادسازی:`, error);
    return false;
  }
};

// ==================[ پردازش کاربران جدید ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        console.log(`👤 کاربر جدید: ${member.first_name} (${member.id})`);
        await quarantineUser(ctx, member);
      }
    }
  } catch (error) {
    console.error('❌ خطا در پردازش کاربر جدید:', error);
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
    ctx.reply('این دستور فقط در گروه‌ها کار می‌کند');
    return;
  }

  const chatId = ctx.chat.id.toString();

  if (!(await isBotAdmin(chatId))) {
    ctx.reply('❌ ربات باید ادمین باشد');
    return;
  }

  // بررسی فعال بودن گروه
  const { data: existingChat } = await supabase
    .from('allowed_chats')
    .select('chat_id')
    .eq('chat_id', chatId)
    .single();

  if (existingChat) {
    ctx.reply('✅ ربات قبلاً فعال شده است');
    return;
  }

  // فعال‌سازی گروه
  await supabase.from('allowed_chats').insert({
    chat_id: chatId,
    chat_title: ctx.chat.title,
    created_at: new Date().toISOString()
  });

  ctx.reply('✅ ربات فعال شد! کاربران جدید قرنطینه خواهند شد.');
});

bot.command('off', async (ctx) => {
  if (!ctx.message.chat.type.includes('group')) {
    ctx.reply('این دستور فقط در گروه‌ها کار می‌کند');
    return;
  }

  const chatId = ctx.chat.id.toString();

  // غیرفعال‌سازی گروه
  await supabase
    .from('allowed_chats')
    .delete()
    .eq('chat_id', chatId);

  ctx.reply('❌ ربات غیرفعال شد!');
});

bot.command('free', async (ctx) => {
  if (!ctx.message.reply_to_message) {
    ctx.reply('❌ روی پیام کاربر ریپلای کنید');
    return;
  }

  const targetUser = ctx.message.reply_to_message.from;
  if (targetUser.is_bot) {
    ctx.reply('❌ نمی‌توان ربات‌ها را آزاد کرد');
    return;
  }

  const success = await releaseUserFromQuarantine(targetUser.id);

  if (success) {
    ctx.reply(`✅ کاربر ${targetUser.first_name} آزاد شد`);
  } else {
    ctx.reply('❌ خطا در آزادسازی کاربر');
  }
});

bot.command('status', async (ctx) => {
  if (!ctx.message.chat.type.includes('group')) {
    ctx.reply('این دستور فقط در گروه‌ها کار می‌کند');
    return;
  }

  const chatId = ctx.chat.id.toString();

  const { data: allowedChat } = await supabase
    .from('allowed_chats')
    .select('chat_id')
    .eq('chat_id', chatId)
    .single();

  if (allowedChat) {
    ctx.reply('✅ ربات فعال است - کاربران جدید قرنطینه می‌شوند');
  } else {
    ctx.reply('❌ ربات غیرفعال است - از /on استفاده کنید');
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
    console.error('❌ خطا در بررسی انقضا:', error);
  }
};

// ==================[ راه‌اندازی سرور ]==================
app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => res.send('ربات قرنطینه فعال است!'));

app.listen(PORT, () => {
  console.log(`🚀 ربات قرنطینه ${SELF_BOT_ID} راه‌اندازی شد`);
  console.log(`🔗 هماهنگی: ${SYNC_ENABLED ? 'فعال' : 'غیرفعال'}`);
  console.log(`👥 ربات‌های متصل: ${BOT_INSTANCES.length}`);
  
  startAutoPing();
});

// کرون جاب برای بررسی انقضا
cron.schedule('0 */6 * * *', () => checkQuarantineExpiry());

// فعال‌سازی وب‌هوک
if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => console.log('✅ وب‌هوک تنظیم شد'))
    .catch(error => {
      console.error('❌ خطا در وب‌هوک:', error);
      bot.launch().then(() => console.log('✅ ربات با پولینگ راه‌اندازی شد'));
    });
} else {
  bot.launch().then(() => console.log('✅ ربات با پولینگ راه‌اندازی شد'));
}
