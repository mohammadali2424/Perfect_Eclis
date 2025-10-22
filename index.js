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

// ==================[ پینگ خودکار برای جلوگیری از خوابیدن ]==================
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

// ==================[ تابع بهبود یافته بررسی مالک ]==================
const isOwner = (userId) => {
  if (!OWNER_ID) {
    console.error('❌ OWNER_ID تنظیم نشده است');
    return false;
  }
  
  const userIdStr = userId.toString().trim();
  const ownerIdStr = OWNER_ID.toString().trim();
  
  return userIdStr === ownerIdStr;
};

// ==================[ توابع کمکی ]==================
const logAction = async (action, userId, chatId = null, details = {}) => {
  try {
    await supabase.from('action_logs').insert({
      action, user_id: userId, chat_id: chatId, details, created_at: new Date().toISOString()
    });
  } catch (error) {
    logger.error('خطا در ثبت فعالیت:', error);
  }
};

// تابع ارسال گزارش به مالک
const sendReportToOwner = async (message) => {
  try {
    await bot.telegram.sendMessage(OWNER_ID, message, {
      parse_mode: 'HTML'
    });
    console.log('✅ گزارش به مالک ارسال شد');
  } catch (error) {
    console.error('❌ خطا در ارسال گزارش به مالک:', error.message);
  }
};

// تابع فرمت‌سازی تاریخ
const formatPersianDate = () => {
  const now = new Date();
  const persianDate = new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(now);
  return persianDate;
};

const isBotAdmin = async (chatId) => {
  try {
    const self = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    return ['administrator', 'creator'].includes(self.status);
  } catch (error) {
    console.error('❌ خطا در بررس�� ادمین بودن ربات:', error);
    return false;
  }
};

const getUserStatus = async (chatId, userId) => {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return member.status;
  } catch (error) {
    if (error.response?.error_code === 400) return 'not_member';
    console.error('❌ خطا در بررسی وضعیت کاربر:', error);
    return null;
  }
};

const removeUserFromChat = async (chatId, userId) => {
  try {
    if (!(await isBotAdmin(chatId))) {
      console.log(`❌ ربات در گروه ${chatId} ادمین نیست، نمی‌تواند کاربر را حذف کند`);
      return false;
    }
    
    const userStatus = await getUserStatus(chatId, userId);
    if (['left', 'kicked', 'not_member'].includes(userStatus)) {
      console.log(`ℹ️ کاربر ${userId} از قبل در گروه ${chatId} نیست`);
      return true;
    }
    
    if (userStatus === 'creator') {
      console.log(`❌ نمی‌توان سازنده گروه ${chatId} را حذف کرد`);
      return false;
    }
    
    console.log(`🗑️ در حال حذف کاربر ${userId} از گروه ${chatId}...`);
    
    await bot.telegram.banChatMember(chatId, userId, {
      until_date: Math.floor(Date.now() / 1000) + 30
    });
    
    await bot.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
    console.log(`✅ کاربر ${userId} از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    if (error.response?.description?.includes("can't remove chat owner")) {
      console.log(`❌ نمی‌توان سازنده گروه ${chatId} را حذف کرد`);
      return false;
    }
    if (error.response?.error_code === 400 && error.response.description?.includes("user not found")) {
      console.log(`ℹ️ کاربر ${userId} در گروه ${chatId} پیدا نشد`);
      return true;
    }
    if (error.response?.error_code === 403) {
      console.log(`❌ ربات در گروه ${chatId} دسترسی ندارد`);
      return false;
    }
    
    console.error(`❌ خطا در حذف کاربر ${userId} از گروه ${chatId}:`, error.message);
    return false;
  }
};

// ==================[ تابع حیاتی: بررسی کاربر در تمام ربات‌های دیگر - کاملاً بازنویسی شده ]==================
const checkUserInAllOtherBots = async (userId) => {
  try {
    console.log(`🔍 بررسی کاربر ${userId} در تمام ربات‌های دیگر...`);
    
    if (!SYNC_ENABLED || BOT_INSTANCES.length === 0) {
      console.log('🔕 حالت هماهنگی غیرفعال ��ست');
      return { found: false, botId: null, chatId: null };
    }

    const otherBots = BOT_INSTANCES.filter(bot => bot.id !== SELF_BOT_ID && bot.type === 'quarantine');
    
    if (otherBots.length === 0) {
      console.log('ℹ️ هیچ ربات قرنطینه دیگری برای بررسی پیدا نشد');
      return { found: false, botId: null, chatId: null };
    }

    console.log(`🔍 در حال بررسی ${otherBots.length} ربات قرنطینه دیگر...`);

    // از Promise.allSettled استفاده می‌کنیم تا اگر بعضی ربات‌ها جواب ندادن، بقیه کار کنن
    const promises = otherBots.map(async (botInstance) => {
      try {
        let apiUrl = botInstance.url;
        if (!apiUrl.startsWith('http')) {
          apiUrl = `https://${apiUrl}`;
        }
        
        apiUrl = apiUrl.replace(/\/$/, '');
        const fullUrl = `${apiUrl}/api/check-quarantine`;
        
        console.log(`🔍 بررسی کاربر در ${botInstance.id} (${apiUrl})...`);
        
        const response = await axios.post(fullUrl, {
          userId: userId,
          secretKey: botInstance.secretKey || API_SECRET_KEY,
          sourceBot: SELF_BOT_ID
        }, {
          timeout: 10000 // 10 ثانیه timeout
        });

        console.log(`✅ پاسخ از ${botInstance.id}:`, response.data);
        
        if (response.data.isQuarantined) {
          console.log(`🚫 کاربر ${userId} در ربات ${botInstance.id} قرنطینه است`);
          return { 
            found: true, 
            botId: botInstance.id, 
            chatId: response.data.currentChatId,
            username: response.data.username,
            firstName: response.data.firstName
          };
        }
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          console.error(`❌ ارتباط با ${botInstance.id} برقرار نشد: سرور در دسترس نیست`);
        } else if (error.response) {
          console.error(`❌ خطا از ${botInstance.id}:`, error.response.status, error.response.data);
        } else if (error.request) {
          console.error(`❌ ${botInstance.id} پاسخی نداد:`, error.message);
        } else {
          console.error(`❌ خطای ناشناخته از ${botInstance.id}:`, error.message);
        }
      }
      return null;
    });

    const results = await Promise.allSettled(promises);
    
    // پیدا کردن اولین نتیجه‌ای که کاربر رو قرنطینه پیدا کرده
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value !== null) {
        console.log(`✅ کاربر در ربات ${result.value.botId} قرنطینه پیدا شد`);
        return result.value;
      }
    }

    console.log(`✅ کاربر ${userId} در هیچ ربات دیگری قرنطینه نیست`);
    return { found: false, botId: null, chatId: null };
  } catch (error) {
    console.error('❌ خطا در بررسی کاربر در تمام ربات‌ها:', error);
    return { found: false, botId: null, chatId: null };
  }
};

// ==================[ تابع حیاتی: اطلاع به تمام ربات‌های دیگر - کاملاً بازنویسی شده ]==================
const notifyAllOtherBots = async (userId, chatId, action) => {
  try {
    console.log(`📢 اطلاع به تمام ربات‌ها برای کاربر ${userId} - عمل: ${action}`);
    
    if (!SYNC_ENABLED || BOT_INSTANCES.length === 0) {
      console.log('🔕 حالت هماهنگی غیرفعال است');
      return;
    }

    const otherBots = BOT_INSTANCES.filter(bot => bot.id !== SELF_BOT_ID && bot.type === 'quarantine');
    
    if (otherBots.length === 0) {
      console.log('ℹ️ هیچ ربات قرنطینه دیگری برای اطلاع‌رسانی پیدا نشد');
      return;
    }

    console.log(`📢 در حال اطلاع‌رسانی به ${otherBots.length} ربات دیگر...`);

    const promises = otherBots.map(async (botInstance) => {
      try {
        let apiUrl = botInstance.url;
        if (!apiUrl.startsWith('http')) {
          apiUrl = `https://${apiUrl}`;
        }
        
        apiUrl = apiUrl.replace(/\/$/, '');
        const fullUrl = `${apiUrl}/api/sync-user`;
        
        console.log(`🔗 ارسال درخواست به ${botInstance.id}...`);
        
        const response = await axios.post(fullUrl, {
          userId: userId,
          chatId: chatId,
          action: action,
          secretKey: botInstance.secretKey || API_SECRET_KEY,
          sourceBot: SELF_BOT_ID
        }, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        console.log(`✅ اطلاع‌رسانی به ${botInstance.id} موفق:`, response.data);
        return { success: true, botId: botInstance.id };
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          console.error(`❌ ارتباط با ${botInstance.id} برقرار نشد`);
        } else if (error.response) {
          console.error(`❌ خطا از ${botInstance.id}:`, error.response.status, error.response.data);
        } else if (error.request) {
          console.error(`❌ ${botInstance.id} پاسخی نداد:`, error.message);
        } else {
          console.error(`❌ خطای ناشناخته از ${botInstance.id}:`, error.message);
        }
        return { success: false, botId: botInstance.id, error: error.message };
      }
    });

    const results = await Promise.allSettled(promises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const total = otherBots.length;
    
    console.log(`✅ اطلاع‌رسانی به ${successful}/${total} ربات موفق بود`);
  } catch (error) {
    console.error('❌ خطا در اطلاع‌رسانی به ربات‌ها:', error);
  }
};

// ==================[ تابع اصلی قرنطینه - منطق کاملاً جدید ]==================
const quarantineUser = async (ctx, user) => {
  try {
    console.log(`🔒 شروع فرآیند قرنطینه برای کاربر: ${user.first_name} (${user.id})`);
    
    const currentChatId = ctx.chat.id.toString();
    const currentChatTitle = ctx.chat.title || 'بدون عنوان';
    const userName = user.first_name || 'ناشناس';

    // 🔍 مرحله 1: بررسی اینکه کاربر در سایر ربات‌ها قرنطینه است
    console.log(`🔍 بررسی کاربر ${user.id} در تمام ربات‌های دیگر...`);
    const userInOtherBot = await checkUserInAllOtherBots(user.id);
    
    if (userInOtherBot.found) {
      console.log(`🚫 کاربر ${user.id} در ربات ${userInOtherBot.botId} قرنطینه است - حذف از گروه فعلی`);
      
      // حذف فوری کاربر از گروه فعلی
      await removeUserFromChat(currentChatId, user.id);
      
      // ارسال گزارش به مالک
      const reportMessage = `
🚨 **کاربر قرنطینه شده به گروه دیگر پیوست**

👤 کاربر: ${userName} (${user.id})
📱 یوزرنیم: ${user.username ? `@${user.username}` : 'ندارد'}

📍 گروه مبدا (قرنطینه): ${userInOtherBot.chatId}
🤖 ربات مبدا: ${userInOtherBot.botId}

📍 گروه مقصد: ${currentChatTitle} (${currentChatId})
🤖 ربات مقصد: ${SELF_BOT_ID}

⏰ زمان: ${formatPersianDate()}
      `;
      
      await sendReportToOwner(reportMessage);
      return false; // کاربر قرنطینه شده، اجازه ورود ندارد
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
    console.log(`🔄 ثبت کاربر ${user.id} در قرنطینه...`);
    
    // ثبت کاربر در دیتابیس
    await supabase.from('quarantine_users').upsert({
      user_id: user.id,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    // 🗑️ مرحله 3: حذف کاربر از گروه‌های محلی دیگر
    console.log(`🗑️ حذف کاربر از گروه‌های محلی دیگر...`);
    await removeUserFromLocalChats(currentChatId, user.id);

    // 📢 مرحله 4: اطلاع به تمام ربات‌های دیگر
    console.log(`📢 اطلاع به تمام ربات‌های دیگر...`);
    await notifyAllOtherBots(user.id, currentChatId, 'quarantine');

    await logAction('user_quarantined', user.id, currentChatId, {
      username: user.username, 
      first_name: user.first_name,
      chat_title: currentChatTitle
    });
    
    console.log(`✅ کاربر ${user.id} با موفقیت قرنطینه شد و به همه ربات‌ها اطلاع داده شد`);
    return true;
    
  } catch (error) {
    console.error('❌ خطا در فرآیند قرنطینه:', error);
    return false;
  }
};

// ==================[ تابع حذف از گروه‌های محلی ]==================
const removeUserFromLocalChats = async (currentChatId, userId) => {
  try {
    console.log(`🗑️ در حال حذف کاربر ${userId} از گروه‌های محلی دیگر...`);
    
    const { data: allChats } = await supabase.from('allowed_chats').select('chat_id, chat_title');
    if (!allChats) return;

    let removedCount = 0;
    for (const chat of allChats) {
      const chatIdStr = chat.chat_id.toString();
      if (chatIdStr === currentChatId.toString()) continue;

      try {
        const userStatus = await getUserStatus(chat.chat_id, userId);
        if (userStatus && !['left', 'kicked', 'not_member'].includes(userStatus)) {
          console.log(`🗑️ حذف کاربر از گروه محلی ${chatIdStr}...`);
          const removed = await removeUserFromChat(chat.chat_id, userId);
          if (removed) removedCount++;
        }
      } catch (error) {
        // کاربر در گروه نیست
      }
    }
    console.log(`✅ کاربر ${userId} از ${removedCount} گروه محلی حذف شد`);
  } catch (error) {
    console.error('❌ خطا در حذف از گروه‌های محلی:', error);
  }
};

// ==================[ تابع آزادسازی کاربر از قرنطینه - بهبود یافته ]==================
const releaseUserFromQuarantine = async (userId) => {
  try {
    console.log(`🔄 در حال آزاد کردن کاربر ${userId} از قرنطینه...`);
    
    // آپدیت وضعیت کاربر در دیتابیس
    const { error: updateError } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);
      
    if (updateError) {
      console.error(`❌ خطا در خارج کردن کاربر ${userId} از قرنطینه:`, updateError);
      return false;
    }
    
    // اطلاع به تمام ربات‌های دیگر
    await notifyAllOtherBots(userId, null, 'release');
    
    console.log(`✅ کاربر ${userId} با موفقیت از قرنطینه خارج شد و به همه ربات‌ها اطلاع داده شد`);
    return true;
  } catch (error) {
    console.error(`❌ خطا در آزادسازی کاربر ${userId}:`, error);
    return false;
  }
};

// ==================[ پردازش اعضای جدید ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    console.log(`🆕 اعضای جدید به گروه ${ctx.chat.id} اضافه شدند`);
    
    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        console.log(`👤 کاربر عادی اضافه شد: ${member.first_name} (${member.id})`);
        await quarantineUser(ctx, member);
      }
    }
  } catch (error) {
    console.error('❌ خطا در پردازش عضو جدید:', error);
  }
});

// ==================[ endpointهای API ]==================
app.post('/api/check-quarantine', async (req, res) => {
  try {
    const { userId, secretKey, sourceBot } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      console.warn('❌ درخواست غیرمجاز برای بررسی قرنطینه کاربر');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    console.log(`🔍 دریافت درخواست بررسی قرنطینه کاربر ${userId} از ${sourceBot || 'unknown'}`);
    
    // بررسی وضعیت کاربر در دیتابیس
    const { data: user } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', userId)
      .single();
      
    if (!user) {
      return res.status(200).json({ 
        isQuarantined: false,
        botId: SELF_BOT_ID,
        note: 'کاربر در این ربات قرنطینه نیست'
      });
    }
    
    res.status(200).json({ 
      isQuarantined: user.is_quarantined,
      currentChatId: user.current_chat_id,
      username: user.username,
      firstName: user.first_name,
      botId: SELF_BOT_ID,
      note: user.is_quarantined ? 'کاربر در این ربات قرنطینه است' : 'کاربر در این ربات آزاد است'
    });
  } catch (error) {
    console.error('❌ خطا در endpoint بررسی قرنطینه:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/sync-user', async (req, res) => {
  try {
    const { userId, chatId, action, secretKey, sourceBot } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log(`🔄 دریافت درخواست هماهنگی از ${sourceBot} برای کاربر ${userId} - عمل: ${action}`);
    
    if (action === 'quarantine') {
      // قرنطینه کردن کاربر در این ربات
      await supabase
        .from('quarantine_users')
        .upsert({
          user_id: userId,
          is_quarantined: true,
          current_chat_id: chatId,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        
      console.log(`✅ کاربر ${userId} در این ربات قرنطینه شد (هماهنگی از ${sourceBot})`);
      
    } else if (action === 'release') {
      // آزاد کردن کاربر
      await supabase
        .from('quarantine_users')
        .update({ 
          is_quarantined: false,
          current_chat_id: null
        })
        .eq('user_id', userId);
      console.log(`✅ کاربر ${userId} از این ربات آزاد شد (هماهنگی از ${sourceBot})`);
    }
    
    res.status(200).json({
      success: true,
      botId: SELF_BOT_ID,
      processed: true,
      message: `User ${userId} synced for action: ${action}`
    });
  } catch (error) {
    console.error('❌ خطا در پردازش هماهنگی:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================[ دستورات مدیریتی ]==================
bot.start((ctx) => {
  ctx.reply('ناظر اکلیس در خدمت شماست 🥷🏻');
});

bot.command('on', async (ctx) => {
  if (!isOwner(ctx.from.id)) {
    ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
    return;
  }

  const chatId = ctx.chat.id.toString();

  // بررسی ادمین بودن ربات
  const botIsAdmin = await isBotAdmin(chatId);
  if (!botIsAdmin) {
    ctx.reply('❌ لطفاً ابتدا ربات را ادمین گروه کنید.');
    return;
  }

  try {
    // فعال‌سازی گروه
    const { error } = await supabase
      .from('allowed_chats')
      .upsert({
        chat_id: chatId,
        chat_title: ctx.chat.title,
        created_at: new Date().toISOString()
      }, { onConflict: 'chat_id' });

    if (error) {
      ctx.reply('❌ خطا در فعال‌سازی گروه.');
      return;
    }

    ctx.reply('✅ ربات با موفقیت فعال شد! از این پس کاربران جدید قرنطینه خواهند شد.');
  } catch (error) {
    ctx.reply('❌ خطا در فعال‌سازی گروه.');
  }
});

// ==================[ راه‌اندازی سرور ]==================
app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => res.send('ربات قرنطینه فعال است!'));

app.listen(PORT, () => {
  console.log(`✅ ربات قرنطینه ${SELF_BOT_ID} روی پورت ${PORT} راه‌اندازی شد`);
  console.log(`🔗 حالت هماهنگی: ${SYNC_ENABLED ? 'فعال' : 'غیرفعال'}`);
  console.log(`👥 تعداد ربات‌های متصل: ${BOT_INSTANCES.length}`);
  
  // شروع پینگ خودکار
  startAutoPing();
});

// فعال سازی وب هوک
if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => console.log(`✅ Webhook تنظیم شد: ${webhookUrl}`))
    .catch(error => {
      console.error('❌ خطا در تنظیم Webhook:', error);
      bot.launch().then(() => {
        console.log('✅ ربات با Long Polling راه‌اندازی شد');
      });
    });
} else {
  bot.launch().then(() => {
    console.log('✅ ربات با Long Polling راه‌اندازی شد');
  });
    }
