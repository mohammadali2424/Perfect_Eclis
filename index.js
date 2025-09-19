const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const winston = require('winston');
const cron = require('node-cron');
const NodeCache = require('node-cache');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware امنیتی
app.use(helmet());
app.use(express.json());

// تنظیمات کش
const cache = new NodeCache({ stdTTL: 300, checkperiod: 600 });

// تنظیمات لاگینگ
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

// بررسی وجود متغیرهای محیطی ضروری
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_KEY', 'BOT_TOKEN'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`❌ متغیر محیطی ${envVar} تعریف نشده است`);
    process.exit(1);
  }
}

// تنظیمات Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// توکن ربات
const bot = new Telegraf(process.env.BOT_TOKEN);

// محدودیت نرخ درخواست
const rateLimit = new Map();

function checkRateLimit(userId, action, limit = 5, windowMs = 60000) {
  const key = `${userId}:${action}`;
  const now = Date.now();
  const userLimits = rateLimit.get(key) || [];
  
  const recentLimits = userLimits.filter(time => now - time < windowMs);
  
  if (recentLimits.length >= limit) {
    return false;
  }
  
  recentLimits.push(now);
  rateLimit.set(key, recentLimits);
  return true;
}

// تابع ثبت فعالیت
async function logAction(action, userId, chatId = null, details = {}) {
  try {
    await supabase
      .from('action_logs')
      .insert({
        action,
        user_id: userId,
        chat_id: chatId,
        details,
        created_at: new Date().toISOString()
      });
  } catch (error) {
    logger.error('خطا در ثبت فعالیت:', error);
  }
}

// تابع بررسی ادمین بودن با کش
async function isChatAdmin(chatId, userId) {
  try {
    const cacheKey = `admin:${chatId}:${userId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    const member = await bot.telegram.getChatMember(chatId, userId);
    const isAdmin = ['administrator', 'creator'].includes(member.status);
    
    cache.set(cacheKey, isAdmin, 300);
    return isAdmin;
  } catch (error) {
    logger.error('خطا در بررسی ادمین:', error);
    return false;
  }
}

// تابع بررسی مالک بودن
async function isOwner(userId) {
  try {
    const cacheKey = `owner:${userId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    const { data, error } = await supabase
      .from('allowed_owners')
      .select('owner_id')
      .eq('owner_id', userId)
      .single();
    
    const isOwner = data !== null;
    cache.set(cacheKey, isOwner, 600);
    return isOwner;
  } catch (error) {
    logger.error('خطا در بررسی مالک:', error);
    return false;
  }
}

// دستور /start
bot.start((ctx) => {
  if (!checkRateLimit(ctx.from.id, 'start')) {
    ctx.reply('درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.');
    return;
  }
  
  ctx.reply('ناظر اکلیس در خدمت شماست 🥷🏻');
  logAction('bot_started', ctx.from.id);
});

// مدیریت اضافه شدن ربات به گروه
bot.on('new_chat_members', async (ctx) => {
  try {
    const newMembers = ctx.message.new_chat_members;
    logger.info(`اعضای جدید در گروه ${ctx.chat.id}: ${newMembers.length} نفر`);
    
    for (const member of newMembers) {
      if (member.is_bot && member.username === ctx.botInfo.username) {
        // ربات به گروه اضافه شده
        logger.info(`ربات به گروه ${ctx.chat.id} اضافه شد`);
        
        if (!(await isChatAdmin(ctx.chat.id, ctx.message.from.id))) {
          logger.info(`کاربر ${ctx.message.from.id} ادمین نیست، ربات گروه را ترک می‌کند`);
          await ctx.leaveChat();
          return;
        }
        
        // ذخیره گروه در دیتابیس
        const { error } = await supabase
          .from('allowed_chats')
          .upsert({
            chat_id: ctx.chat.id.toString(),
            chat_title: ctx.chat.title,
            created_at: new Date().toISOString()
          }, { onConflict: 'chat_id' });
          
        logger.info(`گروه ${ctx.chat.id} در دیتابیس ثبت شد`);
        await logAction('chat_activated', ctx.message.from.id, ctx.chat.id, {
          chat_title: ctx.chat.title
        });
          
      } else if (!member.is_bot) {
        // کاربر عادی به گروه اضافه شده - قرنطینه اتوماتیک
        logger.info(`کاربر عادی ${member.id} به گروه اضافه شد`);
        // اینجا تابع handleNewUser را فراخوانی کنید
      }
    }
  } catch (error) {
    logger.error('خطا در پردازش عضو جدید:', error);
  }
});

// وب سرور برای Render
app.use(bot.webhookCallback('/webhook'));

app.get('/', (req, res) => {
  res.send('ربات قرنطینه فعال است!');
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res);
});

app.listen(PORT, () => {
  logger.info(`سرور روی پورت ${PORT} در حال اجراست`);
});

// فعال سازی وب هوک
if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `https://${process.env.RENDER_EXTERNAL_URL.replace(/^https?:\/\//, '')}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => logger.info(`Webhook تنظیم شد: ${webhookUrl}`))
    .catch(error => logger.error('خطا در تنظیم webhook:', error));
} else {
  logger.warn('آدرس Render تعریف نشده است، از حالت polling استفاده می‌شود');
  bot.launch();
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = app;
