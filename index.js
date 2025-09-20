const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const winston = require('winston');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// تنظیمات لاگینگ
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// تنظیمات Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// توکن ربات
const bot = new Telegraf(process.env.BOT_TOKEN);

// -------------------- API ENDPOINT --------------------
// این قسمت خیلی مهمه! باید دقیقاً اینجا باشه

app.post('/api/release-user', async (req, res) => {
  try {
    const { userId, apiKey } = req.body;
    
    logger.info(`📨 دریافت درخواست آزادسازی کاربر: ${userId}`);
    
    // احراز هویت API
    if (apiKey !== process.env.INTERNAL_API_KEY) {
      logger.warn('❌ API Key نامعتبر');
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized' 
      });
    }
    
    // خارج کردن کاربر از قرنطینه
    const { error } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);
      
    if (error) {
      logger.error('❌ خطا در آزادسازی کاربر:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Internal server error' 
      });
    }
    
    logger.info(`✅ کاربر ${userId} از طریق API آزاد شد`);
    
    res.json({ 
      success: true, 
      message: 'User released successfully' 
    });
    
  } catch (error) {
    logger.error('❌ خطا در پردازش درخواست API:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// -------------------- بقیه کد ربات --------------------

// تابع بررسی ادمین بودن
async function isChatAdmin(chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return ['administrator', 'creator'].includes(member.status);
  } catch (error) {
    logger.error('خطا در بررسی ادمین:', error);
    return false;
  }
}

// مدیریت کاربران جدید
bot.on('new_chat_members', async (ctx) => {
  try {
    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        await supabase
          .from('quarantine_users')
          .upsert({
            user_id: member.id,
            username: member.username,
            first_name: member.first_name,
            is_quarantined: true,
            current_chat_id: ctx.chat.id.toString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });
        
        logger.info(`🔒 کاربر ${member.id} به قرنطینه اضافه شد`);
      }
    }
  } catch (error) {
    logger.error('خطا در پردازش کاربر جدید:', error);
  }
});

// دستور #لیست برای آزادسازی کاربر
bot.hears('#لیست', async (ctx) => {
  try {
    if (!ctx.message.reply_to_message) {
      ctx.reply('لطفاً روی پیام کاربر ریپلای کنید.');
      return;
    }

    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) {
      ctx.reply('شما دسترسی لازم را ندارید.');
      return;
    }

    const targetUser = ctx.message.reply_to_message.from;
    
    await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', targetUser.id);

    ctx.reply(`✅ کاربر ${targetUser.first_name} از قرنطینه خارج شد.`);
    
  } catch (error) {
    logger.error('خطا در دستور #لیست:', error);
    ctx.reply('خطایی رخ داد.');
  }
});

// صفحه اصلی
app.get('/', (req, res) => {
  res.send('🤖 ربات قرنطینه فعال است!');
});

// تست سلامت
app.get('/health', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('quarantine_users')
      .select('count')
      .limit(1);
    
    res.json({ 
      status: 'OK', 
      database: error ? 'Error' : 'Connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// راه‌اندازی سرور
app.listen(PORT, () => {
  logger.info(`🚀 سرور در پورت ${PORT} راه‌اندازی شد`);
  bot.launch();
  logger.info('🤖 ربات تلگرام راه‌اندازی شد');
});

// مدیریت shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
