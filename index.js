const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const NodeCache = require('node-cache');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ==================[ تنظیمات اصلی ]==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SELF_BOT_ID = process.env.SELF_BOT_ID || 'quarantine_1';
const OWNER_ID = parseInt(process.env.OWNER_ID) || 0;

const cache = new NodeCache({ stdTTL: 300 });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

// ==================[ توابع اصلی - منطق کاملاً مرکزی ]==================

// بررسی اینکه کاربر در دیتابیس مرکزی قرنطینه هست یا نه
const checkUserQuarantineStatus = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('quarantine_users')
      .select('user_id, is_quarantined, current_chat_id')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return { isQuarantined: false, currentChatId: null };
    }

    return {
      isQuarantined: data.is_quarantined,
      currentChatId: data.current_chat_id
    };
  } catch (error) {
    return { isQuarantined: false, currentChatId: null };
  }
};

// تابع حذف کاربر از گروه
const removeUserFromChat = async (chatId, userId) => {
  try {
    // بررسی اینکه ربات ادمین هست
    const self = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    if (!['administrator', 'creator'].includes(self.status)) {
      console.log(`❌ ربات در گروه ${chatId} ادمین نیست`);
      return false;
    }

    // بررسی وضعیت کاربر در گروه
    const userStatus = await bot.telegram.getChatMember(chatId, userId)
      .then(member => member.status)
      .catch(() => 'not_member');

    if (['left', 'kicked', 'not_member'].includes(userStatus)) {
      return true; // کاربر از قبل خارج شده
    }

    if (userStatus === 'creator') {
      console.log(`❌ نمی‌توان سازنده گروه را حذف کرد`);
      return false;
    }

    // حذف کاربر
    await bot.telegram.banChatMember(chatId, userId, {
      until_date: Math.floor(Date.now() / 1000) + 30
    });
    
    await bot.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
    
    console.log(`✅ کاربر ${userId} از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    console.log(`❌ خطا در حذف کاربر ${userId}:`, error.message);
    return false;
  }
};

// حذف کاربر از تمام گروه‌های غیرمجاز
const removeUserFromAllOtherChats = async (allowedChatId, userId) => {
  try {
    console.log(`🗑️ حذف کاربر ${userId} از تمام گروه‌های غیر ${allowedChatId}`);

    // دریافت لیست تمام گروه‌های فعال از دیتابیس مرکزی
    const { data: allChats, error } = await supabase
      .from('allowed_chats')
      .select('chat_id, chat_title');

    if (error || !allChats) {
      console.log('❌ خطا در دریافت لیست گروه‌ها');
      return 0;
    }

    let removedCount = 0;

    // حذف کاربر از همه گروه‌ها به جز گروه مجاز
    for (const chat of allChats) {
      if (chat.chat_id.toString() === allowedChatId.toString()) {
        continue; // از گروه مجاز حذف نکن
      }

      const removed = await removeUserFromChat(chat.chat_id, userId);
      if (removed) {
        removedCount++;
        console.log(`✅ کاربر ${userId} از گروه ${chat.chat_title} حذف شد`);
      }
    }

    console.log(`🎯 کاربر ${userId} از ${removedCount} گروه حذف شد`);
    return removedCount;
  } catch (error) {
    console.error('❌ خطا در حذف از گروه‌های دیگر:', error);
    return 0;
  }
};

// تابع اصلی قرنطینه - کاملاً مبتنی بر دیتابیس مرکزی
const quarantineUser = async (ctx, user) => {
  try {
    const currentChatId = ctx.chat.id.toString();
    const userId = user.id;

    console.log(`🔍 بررسی کاربر ${userId} برای قرنطینه در گروه ${currentChatId}`);

    // 1. بررسی وضعیت کاربر در دیتابیس مرکزی
    const quarantineStatus = await checkUserQuarantineStatus(userId);

    if (quarantineStatus.isQuarantined) {
      // کاربر در دیتابیس مرکزی قرنطینه است
      if (quarantineStatus.currentChatId === currentChatId) {
        // کاربر در همان گروهی هست که باید باشه
        console.log(`✅ کاربر ${userId} در گروه مجاز خودش هست`);
        return true;
      } else {
        // کاربر در گروه اشتباهی هست - حذف کن
        console.log(`🚫 کاربر ${userId} در گروه اشتباهی هست - حذف کردن`);
        await removeUserFromChat(currentChatId, userId);
        return false;
      }
    }

    // 2. کاربر قرنطینه نیست - قرنطینه کردن
    console.log(`🔒 قرنطینه کردن کاربر ${userId} در گروه ${currentChatId}`);

    // ذخیره در دیتابیس مرکزی
    const userData = {
      user_id: userId,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('quarantine_users')
      .upsert(userData, { onConflict: 'user_id' });

    if (error) {
      console.error('❌ خطا در ذخیره دیتابیس:', error);
      return false;
    }

    // 3. حذف کاربر از تمام گروه‌های دیگر
    await removeUserFromAllOtherChats(currentChatId, userId);

    console.log(`✅ کاربر ${userId} با موفقیت در دیتابیس مرکزی قرنطینه شد`);
    return true;

  } catch (error) {
    console.error('❌ خطا در فرآیند قرنطینه:', error);
    return false;
  }
};

// تابع آزادسازی کاربر از قرنطینه
const releaseUserFromQuarantine = async (userId) => {
  try {
    console.log(`🔓 آزادسازی کاربر ${userId} از قرنطینه`);

    // به روزرسانی دیتابیس مرکزی
    const { error } = await supabase
      .from('quarantine_users')
      .update({
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) {
      console.error('❌ خطا در به‌روزرسانی دیتابیس:', error);
      return false;
    }

    // پاک کردن کش
    cache.del(`user:${userId}`);

    console.log(`✅ کاربر ${userId} از قرنطینه مرکزی آزاد شد`);
    return true;

  } catch (error) {
    console.error(`❌ خطا در آزادسازی کاربر ${userId}:`, error);
    return false;
  }
};

// ==================[ پردازش اعضای جدید ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    console.log('👥 دریافت عضو جدید در گروه');

    // اگر ربات اضافه شده باشد
    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot && member.id === ctx.botInfo.id) {
        const addedBy = ctx.message.from;
        if (addedBy.id !== OWNER_ID) {
          await ctx.reply('❌ فقط مالک ربات می‌تواند ربات را به گروه اضافه کند.');
          await ctx.leaveChat();
          return;
        }
        await ctx.reply('✅ ربات با موفقیت اضافه شد! از /on برای فعال‌سازی استفاده کنید.');
        return;
      }
    }

    // بررسی اینکه گروه فعال هست
    const chatId = ctx.chat.id.toString();
    const { data: allowedChat } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (!allowedChat) {
      console.log('⚠️ گروه در لیست فعال نیست');
      return;
    }

    // پردازش کاربران عادی
    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        console.log(`🔍 پردازش کاربر ${member.id} (${member.first_name})`);
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
    const { userId } = req.body;
    
    const quarantineStatus = await checkUserQuarantineStatus(userId);
    
    res.status(200).json({
      isQuarantined: quarantineStatus.isQuarantined,
      currentChatId: quarantineStatus.currentChatId,
      botId: SELF_BOT_ID
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/release-user', async (req, res) => {
  try {
    const { userId } = req.body;
    
    const result = await releaseUserFromQuarantine(userId);
    
    res.status(200).json({
      success: result,
      botId: SELF_BOT_ID
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================[ دستورات مدیریتی ]==================
bot.command('on', async (ctx) => {
  try {
    const userId = ctx.from.id;
    if (userId !== OWNER_ID) {
      ctx.reply('❌ فقط مالک ربات می‌تواند این دستور را استفاده کند.');
      return;
    }

    const chatId = ctx.chat.id.toString();

    // بررسی ادمین بودن ربات
    const self = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    if (!['administrator', 'creator'].includes(self.status)) {
      ctx.reply('❌ لطفاً ابتدا ربات را ادمین گروه کنید.');
      return;
    }

    // افزودن گروه به دیتابیس مرکزی
    const chatData = {
      chat_id: chatId,
      chat_title: ctx.chat.title,
      created_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('allowed_chats')
      .upsert(chatData, { onConflict: 'chat_id' });

    if (error) {
      throw error;
    }

    ctx.reply('✅ ربات با موفقیت فعال شد! کاربران جدید به طور خودکار قرنطینه می‌شوند.');
    console.log(`✅ گروه ${ctx.chat.title} به دیتابیس مرکزی اضافه شد`);

  } catch (error) {
    console.error('❌ خطا در فعال‌سازی گروه:', error);
    ctx.reply('❌ خطا در فعال‌سازی گروه.');
  }
});

bot.command('off', async (ctx) => {
  try {
    const userId = ctx.from.id;
    if (userId !== OWNER_ID) {
      ctx.reply('❌ فقط مالک ربات می‌تواند این دستور را استفاده کند.');
      return;
    }

    const chatId = ctx.chat.id.toString();

    // حذف گروه از دیتابیس مرکزی
    const { error } = await supabase
      .from('allowed_chats')
      .delete()
      .eq('chat_id', chatId);

    if (error) {
      throw error;
    }

    ctx.reply('✅ ربات با موفقیت غیرفعال شد!');

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
  
  const { data: allowedChat } = await supabase
    .from('allowed_chats')
    .select('chat_id')
    .eq('chat_id', chatId)
    .single();

  if (allowedChat) {
    ctx.reply('✅ ربات در این گروه فعال است.');
  } else {
    ctx.reply('❌ ربات در این گروه غیرفعال است.');
  }
});

// ==================[ راه‌اندازی سرور ]==================
app.use(bot.webhookCallback('/webhook'));

app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 ربات قرنطینه ${SELF_BOT_ID}</h1>
    <p>ربات فعال است و از دیتابیس مرکزی استفاده می‌کند</p>
    <p>مالک: ${OWNER_ID}</p>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 ربات قرنطینه ${SELF_BOT_ID} راه‌اندازی شد`);
  console.log(`📊 استفاده از دیتابیس مرکزی: ${SUPABASE_URL}`);
});

// راه‌اندازی ربات
if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => console.log('✅ Webhook تنظیم شد'))
    .catch(error => {
      console.error('❌ خطا در تنظیم Webhook:', error);
      bot.launch();
    });
} else {
  bot.launch();
}

// مدیریت خطاها
process.on('unhandledRejection', (error) => {
  console.error('❌ خطای catch نشده:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ خطای مدیریت نشده:', error);
});
