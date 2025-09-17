const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const winston = require('winston');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

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

// تنظیمات Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// توکن ربات و ربات مجاز
const bot = new Telegraf(process.env.BOT_TOKEN);
const ALLOWED_BOT_ID = process.env.ALLOWED_BOT_ID; // آیدی ربات مجاز برای دستور #لیست

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

// تابع بررسی مالک بودن
async function isOwner(userId) {
  try {
    const { data, error } = await supabase
      .from('allowed_owners')
      .select('owner_id')
      .eq('owner_id', userId)
      .single();
    
    return data !== null;
  } catch (error) {
    logger.error('خطا در بررسی مالک:', error);
    return false;
  }
}

// تابع بررسی اینکه آیا ربات ادمین است
async function isBotAdmin(chatId) {
  try {
    const self = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    return ['administrator', 'creator'].includes(self.status);
  } catch (error) {
    logger.error('خطا در بررسی ادمین بودن ربات:', error);
    return false;
  }
}

// تابع بررسی وضعیت کاربر در گروه
async function getUserStatus(chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return member.status;
  } catch (error) {
    // اگر کاربر در گروه نیست یا خطای دیگری رخ داد
    if (error.response && error.response.error_code === 400) {
      return 'not_member';
    }
    logger.error('خطا در بررسی وضعیت کاربر:', error);
    return null;
  }
}

// تابع حذف کاربر از گروه (بدون بن)
async function removeUserFromChat(chatId, userId) {
  try {
    // ابتدا مطمئن شویم ربات ادمین است
    if (!(await isBotAdmin(chatId))) {
      logger.error('ربات در گروه ادمین نیست');
      return false;
    }
    
    // بررسی وضعیت کاربر در گروه
    const userStatus = await getUserStatus(chatId, userId);
    
    // اگر کاربر در گروه نیست یا قبلاً حذف شده
    if (userStatus === 'not_member' || userStatus === 'left' || userStatus === 'kicked') {
      logger.info(`کاربر ${userId} از قبل در گروه ${chatId} نیست`);
      return true;
    }
    
    // اگر کاربر مالک گروه است، نمی‌توانیم حذفش کنیم
    if (userStatus === 'creator') {
      logger.warn(`کاربر ${userId} مالک گروه است و نمی‌توان حذف کرد`);
      return false;
    }
    
    // حذف کاربر بدون بن کردن
    await bot.telegram.unbanChatMember(chatId, userId);
    logger.info(`کاربر ${userId} از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    // اگر خطا مربوط به مالک گروه بودن کاربر است، آن را نادیده بگیر
    if (error.response && error.response.description && error.response.description.includes("can't remove chat owner")) {
      logger.warn(`کاربر ${userId} مالک گروه است و نمی‌توان حذف کرد`);
      return false;
    }
    
    // اگر خطا مربوط به عدم وجود کاربر در گروه است
    if (error.response && error.response.error_code === 400 && error.response.description.includes("user not found")) {
      logger.info(`کاربر ${userId} در گروه ${chatId} پیدا نشد`);
      return true;
    }
    
    logger.error('خطا در حذف کاربر از گروه:', error);
    return false;
  }
}

// تابع بررسی و حذف کاربر از تمام گروه‌های دیگر
async function removeUserFromAllOtherChats(currentChatId, userId) {
  try {
    // دریافت تمام گروه‌های مجاز
    const { data: allChats, error: chatsError } = await supabase
      .from('allowed_chats')
      .select('chat_id');
    
    if (chatsError) {
      logger.error('خطا در دریافت گروه‌ها:', chatsError);
      return;
    }
    
    if (allChats && allChats.length > 0) {
      logger.info(`حذف کاربر ${userId} از ${allChats.length} گروه به جز ${currentChatId}`);
      
      for (const chat of allChats) {
        if (chat.chat_id.toString() !== currentChatId.toString()) {
          try {
            logger.info(`تلاش برای حذف کاربر از گروه ${chat.chat_id}`);
            await removeUserFromChat(chat.chat_id, userId);
          } catch (error) {
            logger.error(`حذف از گروه ${chat.chat_id} نامو��ق بود:`, error);
          }
        }
      }
    } else {
      logger.info('هیچ گروهی در دیتابیس ثبت نشده است');
    }
  } catch (error) {
    logger.error('خطا در حذف کاربر از گروه‌های دیگر:', error);
  }
}

// تابع پردازش کاربر جدید (قرنطینه اتوماتیک)
async function handleNewUser(ctx, user) {
  try {
    const now = new Date().toISOString();
    logger.info(`پردازش کاربر جدید: ${user.id} در گروه ${ctx.chat.id}`);
    
    // بررسی آیا کاربر در حال حاضر در قرنطینه است
    const { data: existingUser, error: queryError } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_quarantined', true)
      .single();

    if (queryError && queryError.code !== 'PGRST116') {
      logger.error('خطا در بررسی کاربر موجود:', queryError);
      return;
    }

    if (existingUser) {
      logger.info(`کاربر ${user.id} از قبل در قرنطینه است`);
      
      // کاربر از قبل در قرنطینه است
      if (existingUser.current_chat_id !== ctx.chat.id) {
        // کاربر از گروه فعلی حذف شود
        logger.info(`حذف کاربر از گروه فعلی ${ctx.chat.id}`);
        await removeUserFromChat(ctx.chat.id, user.id);
      }
      
      // کاربر از تمام گروه‌های دیگر حذف شود
      logger.info(`حذف کاربر از سایر گروه‌ها به جز ${existingUser.current_chat_id}`);
      await removeUserFromAllOtherChats(existingUser.current_chat_id, user.id);
      
      // به روز رسانی گروه فعلی کاربر
      const { error: updateError } = await supabase
        .from('quarantine_users')
        .update({ 
          current_chat_id: ctx.chat.id,
          updated_at: now
        })
        .eq('user_id', user.id);
        
      if (updateError) {
        logger.error('خطا در به روز رسانی کاربر:', updateError);
      }
        
    } else {
      // کاربر جدید - قرنطینه اتوماتیک
      logger.info(`کاربر ${user.id} جدید است، افزودن به قرنطینه`);
      
      const { error: insertError } = await supabase
        .from('quarantine_users')
        .upsert({
          user_id: user.id,
          username: user.username,
          first_name: user.first_name,
          is_quarantined: true,
          current_chat_id: ctx.chat.id,
          created_at: now,
          updated_at: now
        }, { onConflict: 'user_id' });
      
      if (insertError) {
        logger.error('خطا در ذخیره کاربر در قرنطینه:', insertError);
        return;
      }
      
      // کاربر از تمام گروه‌های دیگر حذف شود
      logger.info(`حذف کاربر ${user.id} از سایر گروه‌ها به جز ${ctx.chat.id}`);
      await removeUserFromAllOtherChats(ctx.chat.id, user.id);
      
      // ثبت فعالیت
      await logAction('user_quarantined', user.id, ctx.chat.id, {
        username: user.username,
        first_name: user.first_name
      });
    }
  } catch (error) {
    logger.error('خطا در پردازش کاربر جدید:', error);
  }
}

// تابع بررسی انقضای قرنطینه
async function checkQuarantineExpiry() {
  try {
    const { data: expiredUsers, error } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('is_quarantined', true)
      .lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    
    if (expiredUsers && expiredUsers.length > 0) {
      logger.info(`پیدا کردن ${expiredUsers.length} کاربر با قرنطینه منقضی شده`);
      
      for (const user of expiredUsers) {
        await supabase
          .from('quarantine_users')
          .update({ 
            is_quarantined: false,
            current_chat_id: null,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user.user_id);
          
        logger.info(`قرنطینه کاربر ${user.user_id} به علت انقضا پایان یافت`);
        
        // ثبت فعالیت
        await logAction('quarantine_expired', user.user_id, null, {
          username: user.username,
          first_name: user.first_name
        });
      }
    }
  } catch (error) {
    logger.error('خطا در بررسی انقضای قرنطینه:', error);
  }
}

// دستور /start
bot.start((ctx) => {
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
            chat_id: ctx.chat.id,
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
        await handleNewUser(ctx, member);
      }
    }
  } catch (error) {
    logger.error('خطا در پردازش عضو جدید:', error);
  }
});

// دستور #فعال برای ثبت گروه
bot.hears('#فعال', async (ctx) => {
  try {
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) return;
    
    const { error } = await supabase
      .from('allowed_chats')
      .upsert({
        chat_id: ctx.chat.id,
        chat_title: ctx.chat.title,
        created_at: new Date().toISOString()
      }, { onConflict: 'chat_id' });
    
    ctx.reply('منطقه فعال شد ✅');
    await logAction('chat_activated', ctx.from.id, ctx.chat.id, {
      chat_title: ctx.chat.title
    });
  } catch (error) {
    logger.error('خطا در دستور فعال:', error);
  }
});

// دستور #غیرفعال برای حذف گروه
bot.hears('#غیرفعال', async (ctx) => {
  try {
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) return;
    
    const { error } = await supabase
      .from('allowed_chats')
      .delete()
      .eq('chat_id', ctx.chat.id);
    
    ctx.reply('منطقه غیرفعال شد ❌');
    await logAction('chat_deactivated', ctx.from.id, ctx.chat.id, {
      chat_title: ctx.chat.title
    });
  } catch (error) {
    logger.error('خطا در دستور غیرفعال:', error);
  }
});

// دستور #ورود - نمایش پیام تاخیری مربوط به تریگر
bot.hears('#ورود', async (ctx) => {
  try {
    // دریافت پیام تاخیری از دیتابیس (به جای پیام ثابت)
    const { data: triggerMessage, error } = await supabase
      .from('trigger_messages')
      .select('message_text')
      .eq('trigger_type', 'ورود')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let messageToSend = "پیام پیش فرض برای ورود"; // پیام پیش فرض
    
    if (!error && triggerMessage) {
      messageToSend = triggerMessage.message_text;
    }

    // ارسال پیام تاخیری به کاربر
    ctx.reply(messageToSend);
    await logAction('user_entered', ctx.from.id, ctx.chat.id, {
      message_sent: messageToSend
    });
  } catch (error) {
    logger.error('خطا در پردازش دستور ورود:', error);
  }
});

// دستور #لیست - فقط برای ربات مجاز
bot.on('text', async (ctx) => {
  try {
    const messageText = ctx.message.text;
    
    // بررسی آیا پیام از ربات مجاز است و حاوی #لیست است
    const isFromAllowedBot = ctx.from.id.toString() === ALLOWED_BOT_ID;
    const isListCommand = messageText && messageText.includes('#لیست');
    
    if (isFromAllowedBot && isListCommand) {
      // بررسی آیا پیام ریپلای است
      if (ctx.message.reply_to_message) {
        const targetUser = ctx.message.reply_to_message.from;
        
        const { error } = await supabase
          .from('quarantine_users')
          .update({ 
            is_quarantined: false,
            current_chat_id: null,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', targetUser.id);
          
        if (!error) {
          logger.info(`کاربر ${targetUser.id} توسط ربات مجاز از قرنطینه خارج شد`);
          await logAction('user_released_by_bot', ctx.from.id, null, {
            target_user_id: targetUser.id,
            target_username: targetUser.username,
            target_first_name: targetUser.first_name
          });
          
          // پاسخ به ربات مجاز
          ctx.reply(`کاربر ${targetUser.first_name} با موفقیت از قرنطینه خارج شد.`);
        } else {
          ctx.reply('خطا در خارج کردن کاربر از قرنطینه.');
        }
      }
    } else if (isListCommand && !isFromAllowedBot) {
      // اگر کاربر عادی سعی در استفاده از #لیست دارد
      logger.warn(`کاربر ${ctx.from.id} سعی در استفاده از دستور #لیست بدون مجوز دارد`);
      ctx.reply('شما مجوز استفاده از این دستور را ندارید.');
    }
  } catch (error) {
    logger.error('خطا در پردازش دستور لیست:', error);
  }
});

// دستور #حذف برای ادمین‌ها (ریپلای روی کاربر)
bot.on('message', async (ctx) => {
  try {
    const messageText = ctx.message.text;
    
    if (messageText && messageText.includes('#حذف') && ctx.message.reply_to_message) {
      if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) return;
      
      const targetUser = ctx.message.reply_to_message.from;
      
      const { error } = await supabase
        .from('quarantine_users')
        .update({ 
          is_quarantined: false,
          current_chat_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', targetUser.id);
        
      if (!error) {
        ctx.reply(`کاربر ${targetUser.first_name} از قرنطینه خارج شد.`);
        await logAction('user_released_by_admin', ctx.from.id, ctx.chat.id, {
          target_user_id: targetUser.id,
          target_username: targetUser.username,
          target_first_name: targetUser.first_name
        });
      }
    }
  } catch (error) {
    logger.error('خطا در پردازش دستور حذف:', error);
  }
});

// دستور #حذف برای مالک‌ها (با آیدی کاربر)
bot.on('text', async (ctx) => {
  try {
    const messageText = ctx.message.text;
    
    // بررسی آیا پیام با #حذف شروع می‌شود و بعد از آن یک عدد (آیدی) وجود دارد
    const match = messageText.match(/^#حذف\s+(\d+)$/);
    
    if (match && (await isOwner(ctx.from.id))) {
      const targetUserId = match[1];
      
      const { error } = await supabase
        .from('quarantine_users')
        .update({ 
          is_quarantined: false,
          current_chat_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', targetUserId);
        
      if (!error) {
        ctx.reply(`کاربر با آیدی ${targetUserId} از قرنطینه خارج شد.`);
        await logAction('user_released_by_owner', ctx.from.id, null, {
          target_user_id: targetUserId
        });
      }
    }
  } catch (error) {
    logger.error('خطا در پردازش دستور حذف با آیدی:', error);
  }
});

// دستور #وضعیت برای مالک‌ها
bot.hears('#وضعیت', async (ctx) => {
  try {
    if (!(await isOwner(ctx.from.id))) return;
    
    const { data: chats, error: chatsError } = await supabase
      .from('allowed_chats')
      .select('*');
    
    const { data: users, error: usersError } = await supabase
      .from('quarantine_users')
      .select('*')
      .eq('is_quarantined', true);
    
    ctx.reply(`
📊 آمار ربات:
👥 گروه های فعال: ${chats?.length || 0}
🔒 کاربران قرنطینه: ${users?.length || 0}
    `);
    
    await logAction('status_check', ctx.from.id);
  } catch (error) {
    logger.error('خطا در دستور وضعیت:', error);
  }
});

// دستور #راهنما
bot.hears('#راهنما', (ctx) => {
  const helpText = `
🤖 راهنمای ربات قرنطینه:

#فعال - فعال کردن ربات در گروه
#غیرفعال - غیرفعال کردن ربات در گروه
#ورود - دریافت پیام تاخیری (برای کاربران)
#حذف (ریپلای) - حذف کاربر از قرنطینه (ادمین‌ها)
#وضعیت - مشاهده آمار ربات (فقط مالک)
#راهنما - نمایش این راهنما

ربات مجاز می‌تواند با دستور #لیست کاربران را از قرنطینه خارج کند.
  `;
  
  ctx.reply(helpText);
  logAction('help_requested', ctx.from.id);
});

// وب سرور برای Render
app.use(express.json());
app.use(bot.webhookCallback('/webhook'));

app.get('/', (req, res) => {
  res.send('ربات قرنطینه فعال است!');
});

app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res);
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

// فعال سازی بررسی انقضای قرنطینه (هر 6 ساعت یکبار)
cron.schedule('0 */6 * * *', () => {
  logger.info('بررسی خودکار انقضای قرنطینه آغاز شد');
  checkQuarantineExpiry();
});

// فعال سازی وب هوک (یک بار اجرا شود)
// bot.telegram.setWebhook('https://your-render-url.onrender.com/webhook');
