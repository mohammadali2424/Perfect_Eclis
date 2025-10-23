const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ==================[ تنظیمات ]==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SELF_BOT_ID = process.env.SELF_BOT_ID || 'quarantine_1';
const OWNER_ID = parseInt(process.env.OWNER_ID) || 0;
const API_SECRET_KEY = process.env.API_SECRET_KEY;

// کش فوق العاده بهینه
const cache = new NodeCache({ 
  stdTTL: 1800,
  checkperiod: 900,
  maxKeys: 3000,
  useClones: false
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

// ==================[ پینگ هوشمند 13:59 دقیقه ]==================
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) return;

  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  const performPing = async () => {
    try {
      await axios.head(`${selfUrl}/ping`, { 
        timeout: 5000,
        headers: { 'User-Agent': 'AutoPing' }
      });
    } catch (error) {
      setTimeout(performPing, 60000);
    }
  };

  setTimeout(performPing, 30000);
  setInterval(performPing, PING_INTERVAL);
};

app.head('/ping', (req, res) => res.status(200).end());
app.get('/ping', (req, res) => {
  res.status(200).json({ 
    status: 'active', 
    bot: SELF_BOT_ID,
    t: Date.now()
  });
});

// ==================[ توابع اصلی - فوق بهینه ]==================
const isBotAdmin = async (chatId) => {
  try {
    const cacheKey = `admin_${chatId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const self = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    const isAdmin = ['administrator', 'creator'].includes(self.status);
    
    cache.set(cacheKey, isAdmin, 1800);
    return isAdmin;
  } catch (error) {
    return false;
  }
};

const removeUserFromChat = async (chatId, userId) => {
  try {
    if (!(await isBotAdmin(chatId))) return false;

    const userStatus = await bot.telegram.getChatMember(chatId, userId)
      .then(member => member.status)
      .catch(() => 'not_member');

    if (['left', 'kicked', 'not_member'].includes(userStatus)) return true;
    if (userStatus === 'creator') return false;

    await bot.telegram.banChatMember(chatId, userId, {
      until_date: Math.floor(Date.now() / 1000) + 30
    });
    
    await bot.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
    return true;
  } catch (error) {
    return false;
  }
};

// بررسی وضعیت کاربر از دیتابیس مرکزی
const getUserQuarantineStatus = async (userId) => {
  try {
    const cacheKey = `user_${userId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const { data } = await supabase
      .from('quarantine_users')
      .select('is_quarantined, current_chat_id')
      .eq('user_id', userId)
      .single();

    const result = data ? {
      isQuarantined: data.is_quarantined,
      currentChatId: data.current_chat_id
    } : { isQuarantined: false, currentChatId: null };

    cache.set(cacheKey, result, 900);
    return result;
  } catch (error) {
    return { isQuarantined: false, currentChatId: null };
  }
};

// حذف کاربر از تمام گروه‌های غیرمجاز
const removeFromOtherChats = async (allowedChatId, userId) => {
  try {
    const { data: allChats } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .neq('chat_id', allowedChatId);

    if (!allChats) return 0;

    let removed = 0;
    for (const chat of allChats) {
      const result = await removeUserFromChat(chat.chat_id, userId);
      if (result) removed++;
    }
    
    return removed;
  } catch (error) {
    return 0;
  }
};

// تابع اصلی قرنطینه
const quarantineUser = async (ctx, user) => {
  try {
    const currentChatId = ctx.chat.id.toString();
    const userId = user.id;

    // بررسی وضعیت کاربر در دیتابیس مرکزی
    const status = await getUserQuarantineStatus(userId);

    if (status.isQuarantined) {
      if (status.currentChatId === currentChatId) {
        return true; // کاربر در گروه مجاز خودش هست
      } else {
        await removeUserFromChat(currentChatId, userId);
        return false;
      }
    }

    // کاربر جدید - قرنطینه کردن
    const userData = {
      user_id: userId,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId,
      updated_at: new Date().toISOString()
    };

    await supabase.from('quarantine_users')
      .upsert(userData, { onConflict: 'user_id' });

    // پاک کردن کش کاربر
    cache.del(`user_${userId}`);

    // حذف از گروه‌های دیگر
    await removeFromOtherChats(currentChatId, userId);

    return true;
  } catch (error) {
    return false;
  }
};

// آزادسازی کاربر
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

    // پاک کردن کش
    cache.del(`user_${userId}`);
    
    return true;
  } catch (error) {
    return false;
  }
};

// ==================[ پردازش اعضای جدید ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    // اگر ربات اضافه شده
    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot && member.id === ctx.botInfo.id) {
        if (ctx.message.from.id !== OWNER_ID) {
          await ctx.reply('❌ فقط مالک');
          await ctx.leaveChat();
          return;
        }
        await ctx.reply('✅ ربات اضافه شد! /on');
        return;
      }
    }

    // بررسی فعال بودن گروه
    const chatId = ctx.chat.id.toString();
    const { data: allowedChat } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (!allowedChat) return;

    // پردازش کاربران
    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        await quarantineUser(ctx, member);
      }
    }
  } catch (error) {
    // بدون لاگ
  }
});

// ==================[ API های سبک ]==================
app.post('/api/release-user', async (req, res) => {
  try {
    const { u: userId, k: secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ e: 'unauthorized' });
    }
    
    const result = await releaseUserFromQuarantine(userId);
    
    res.status(200).json({ 
      s: result,
      b: SELF_BOT_ID
    });
  } catch (error) {
    res.status(500).json({ e: 'error' });
  }
});

app.post('/api/check-quarantine', async (req, res) => {
  try {
    const { u: userId, k: secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ e: 'unauthorized' });
    }
    
    const status = await getUserQuarantineStatus(userId);
    
    res.status(200).json({
      q: status.isQuarantined,
      c: status.currentChatId,
      b: SELF_BOT_ID
    });
  } catch (error) {
    res.status(500).json({ e: 'error' });
  }
});

// ==================[ دستورات مدیریتی ]==================
bot.command('on', async (ctx) => {
  try {
    if (ctx.from.id !== OWNER_ID) {
      ctx.reply('❌ فقط مالک');
      return;
    }

    const chatId = ctx.chat.id.toString();
    
    if (!(await isBotAdmin(chatId))) {
      ctx.reply('❌ ربات باید ادمین باشد');
      return;
    }

    const chatData = {
      chat_id: chatId,
      chat_title: ctx.chat.title,
      created_at: new Date().toISOString()
    };

    await supabase.from('allowed_chats')
      .upsert(chatData, { onConflict: 'chat_id' });

    // پاک کردن کش گروه‌ها
    cache.del('allowed_chats_list');

    ctx.reply('✅ ربات فعال شد!');
  } catch (error) {
    ctx.reply('❌ خطا');
  }
});

bot.command('off', async (ctx) => {
  try {
    if (ctx.from.id !== OWNER_ID) {
      ctx.reply('❌ فقط مالک');
      return;
    }

    const chatId = ctx.chat.id.toString();
    
    await supabase.from('allowed_chats')
      .delete()
      .eq('chat_id', chatId);

    // پاک کردن کش
    cache.del('allowed_chats_list');
    cache.del(`admin_${chatId}`);

    ctx.reply('✅ ربات غیرفعال شد');
    
    try {
      await ctx.leaveChat();
    } catch (error) {
      // بدون لاگ
    }
  } catch (error) {
    ctx.reply('❌ خطا');
  }
});

bot.command('status', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  
  const { data: allowedChat } = await supabase
    .from('allowed_chats')
    .select('chat_id')
    .eq('chat_id', chatId)
    .single();

  ctx.reply(allowedChat ? '✅ فعال' : '❌ غیرفعال');
});

// ==================[ راه‌اندازی ]==================
app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => {
  res.send(`🤖 قرنطینه ${SELF_BOT_ID} فعال`);
});

app.listen(PORT, () => {
  console.log(`🚀 قرنطینه ${SELF_BOT_ID} راه‌اندازی شد`);
  startAutoPing();
});

if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => console.log('✅ Webhook تنظیم شد'))
    .catch(() => bot.launch());
} else {
  bot.launch();
}

// مدیریت خطا
process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});
