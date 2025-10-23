const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const NodeCache = require('node-cache');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SELF_BOT_ID = process.env.SELF_BOT_ID || 'quarantine_1';
const SYNC_ENABLED = process.env.SYNC_ENABLED === 'true';
const API_SECRET_KEY = process.env.API_SECRET_KEY;
const BOT_INSTANCES = process.env.BOT_INSTANCES ? JSON.parse(process.env.BOT_INSTANCES) : [];
const OWNER_ID = parseInt(process.env.OWNER_ID) || 0;

const cache = new NodeCache({ 
  stdTTL: 900,
  maxKeys: 5000
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

// تابع اصلی قرنطینه - کاملاً بازنویسی شده
const quarantineUser = async (ctx, user) => {
  try {
    const currentChatId = ctx.chat.id.toString();
    const userId = user.id;

    console.log(`بررسی کاربر ${userId} برای قرنطینه در گروه ${currentChatId}`);

    // 1. اول از همه بررسی کن که کاربر در همین ربات قرنطینه هست یا نه
    const cachedUser = cache.get(`user:${userId}`);
    if (cachedUser && cachedUser.is_quarantined) {
      if (cachedUser.current_chat_id === currentChatId) {
        console.log(`کاربر ${userId} در همین گروه قرنطینه است - اجازه ورود`);
        return true;
      } else {
        console.log(`کاربر ${userId} در گروه دیگر قرنطینه است - حذف از گروه فعلی`);
        await removeUserFromChat(currentChatId, userId);
        return false;
      }
    }

    // 2. بررسی دیتابیس
    const { data: existingUser } = await supabase
      .from('quarantine_users')
      .select('user_id, is_quarantined, current_chat_id')
      .eq('user_id', userId)
      .single();

    if (existingUser) {
      if (existingUser.is_quarantined) {
        if (existingUser.current_chat_id === currentChatId) {
          console.log(`کاربر ${userId} در دیتابیس در همین گروه قرنطینه است`);
          cache.set(`user:${userId}`, existingUser, 600);
          return true;
        } else {
          console.log(`کاربر ${userId} در دیتابیس در گروه دیگر قرنطینه است - حذف`);
          cache.set(`user:${userId}`, existingUser, 600);
          await removeUserFromChat(currentChatId, userId);
          return false;
        }
      } else {
        console.log(`کاربر ${userId} در دیتابیس آزاد است - اجازه ورود`);
        cache.set(`user:${userId}`, existingUser, 600);
        return true;
      }
    }

    // 3. اگر کاربر جدید است و در هیچ‌جا قرنطینه نیست
    console.log(`کاربر ${userId} جدید است - قرنطینه در گروه ${currentChatId}`);
    
    const userData = {
      user_id: userId,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId,
      updated_at: new Date().toISOString()
    };

    await supabase.from('quarantine_users').upsert(userData, { 
      onConflict: 'user_id' 
    });

    cache.set(`user:${userId}`, userData, 600);

    // 4. حذف از گروه‌های دیگر همین ربات
    await removeUserFromLocalChats(currentChatId, userId);

    console.log(`کاربر ${userId} با موفقیت قرنطینه شد`);
    return true;
    
  } catch (error) {
    console.error('خطا در فرآیند قرنطینه:', error);
    return false;
  }
};

// تابع آزادسازی - کاملاً بازنویسی شده
const releaseUserFromQuarantine = async (userId) => {
  try {
    console.log(`شروع آزادسازی کاربر ${userId} از قرنطینه`);

    // 1. به روزرسانی دیتابیس
    const { error: updateError } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error(`خطا در به‌روزرسانی دیتابیس:`, updateError);
      return false;
    }
    
    // 2. پاک کردن کش - این قسمت خیلی مهم است
    cache.del(`user:${userId}`);
    
    // 3. اطلاع به سایر ربات‌های قرنطینه
    if (SYNC_ENABLED) {
      const otherBots = BOT_INSTANCES.filter(bot => 
        bot.id !== SELF_BOT_ID && bot.type === 'quarantine'
      );
      
      console.log(`اطلاع به ${otherBots.length} ربات قرنطینه دیگر`);

      for (const botInstance of otherBots) {
        try {
          let apiUrl = botInstance.url;
          if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
          
          await axios.post(`${apiUrl}/api/sync-release`, {
            userId: userId,
            secretKey: botInstance.secretKey || API_SECRET_KEY,
            sourceBot: SELF_BOT_ID
          }, { timeout: 8000 });

          console.log(`ربات ${botInstance.id} از آزادسازی کاربر مطلع شد`);
        } catch (error) {
          console.log(`خطا در اطلاع به ربات ${botInstance.id}:`, error.message);
        }
      }
    }
    
    console.log(`کاربر ${userId} با موفقیت از قرنطینه آزاد شد`);
    return true;
  } catch (error) {
    console.error(`خطا در آزادسازی کاربر ${userId}:`, error);
    return false;
  }
};

// endpoint جدید برای هماهنگی آزادسازی
app.post('/api/sync-release', async (req, res) => {
  try {
    const { userId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log(`دریافت درخواست هماهنگی آزادسازی برای کاربر ${userId}`);

    // کاربر را در این ربات هم آزاد کن
    const { error: updateError } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('خطا در هماهنگی آزادسازی:', updateError);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // کش را پاک کن
    cache.del(`user:${userId}`);
    
    console.log(`کاربر ${userId} در این ربا�� هم آزاد شد`);
    
    res.status(200).json({ 
      success: true,
      botId: SELF_BOT_ID,
      message: `کاربر ${userId} آزاد شد`
    });
  } catch (error) {
    console.error('خطا در endpoint هماهنگی:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// endpoint آزادسازی از ربات تریگر
app.post('/api/release-user', async (req, res) => {
  try {
    const { userId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log(`دریافت درخواست آزادسازی کاربر ${userId} از ربات تریگر`);
    
    const result = await releaseUserFromQuarantine(userId);
    
    res.status(200).json({ 
      success: result,
      botId: SELF_BOT_ID,
      message: result ? `کاربر ${userId} آزاد شد` : `خطا در آزادسازی کاربر ${userId}`
    });
  } catch (error) {
    console.error('خطا در endpoint آزادسازی:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// endpoint بررسی وضعیت قرنطینه
app.post('/api/check-quarantine', async (req, res) => {
  try {
    const { userId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // اول از کش چک کن
    const cachedUser = cache.get(`user:${userId}`);
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
      cache.set(`user:${userId}`, user, 600);
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

// توابع کمکی
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
    if (!(await isBotAdmin(chatId))) return false;
    
    const userStatus = await getUserStatus(chatId, userId);
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

const removeUserFromLocalChats = async (currentChatId, userId) => {
  try {
    const { data: allChats } = await supabase.from('allowed_chats').select('chat_id');
    if (!allChats) return 0;

    let removedCount = 0;
    for (const chat of allChats) {
      if (chat.chat_id.toString() === currentChatId) continue;
      const removed = await removeUserFromChat(chat.chat_id, userId);
      if (removed) removedCount++;
    }
    
    return removedCount;
  } catch (error) {
    return 0;
  }
};

// پردازش اعضای جدید
bot.on('new_chat_members', async (ctx) => {
  try {
    // اگر ربات اضافه شده باشد
    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot && member.id === ctx.botInfo.id) {
        const addedBy = ctx.message.from;
        if (!isOwner(addedBy.id)) {
          await ctx.reply('❌ فقط مالک ربات می‌تواند ربات را به گروه اضافه کند.');
          await ctx.leaveChat();
          return;
        }
        await ctx.reply('✅ ربات با موفقیت اضافه شد! از دستور /on برای فعال‌سازی استفاده کنید.');
        return;
      }
    }

    // پردازش کاربران عادی
    const chatId = ctx.chat.id.toString();
    const { data: allowedChat } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (!allowedChat) return;

    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        await quarantineUser(ctx, member);
      }
    }
  } catch (error) {
    console.error('خطا در پردازش عضو جدید:', error);
  }
});

// دستورات مدیریتی
const isOwner = (userId) => userId === OWNER_ID;

const isOwnerOrCreator = async (ctx) => {
  try {
    const userId = ctx.from.id;
    if (isOwner(userId)) return { hasAccess: true, isOwner: true };
    if (ctx.chat.type === 'private') return { hasAccess: false, reason: 'این دستور فقط در گروه کار می‌کند' };

    const member = await ctx.getChatMember(userId);
    if (member.status === 'creator') return { hasAccess: true, isCreator: true };

    return { hasAccess: false, reason: 'شما دسترسی لازم را ندارید' };
  } catch (error) {
    return { hasAccess: false, reason: 'خطا در بررسی دسترسی' };
  }
};

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

    await supabase.from('allowed_chats').upsert(chatData, { onConflict: 'chat_id' });
    cache.del('allowed_chats');

    ctx.reply('✅ ربات با موفقیت فعال شد!');
  } catch (error) {
    ctx.reply('❌ خطا در فعال‌سازی گروه.');
  }
});

bot.command('off', async (ctx) => {
  try {
    const access = await isOwnerOrCreator(ctx);
    if (!access.hasAccess) {
      ctx.reply(`❌ ${access.reason}`);
      return;
    }

    const chatId = ctx.chat.id.toString();
    await supabase.from('allowed_chats').delete().eq('chat_id', chatId);
    cache.del('allowed_chats');

    ctx.reply('✅ ربات با موفقیت غیرفعال شد!');
    
    try {
      await ctx.leaveChat();
    } catch (leaveError) {
      // ignore
    }
  } catch (error) {
    ctx.reply('❌ خطایی در غیرفعال کردن ربات رخ داد.');
  }
});

// راه‌اندازی سرور
app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => {
  res.send(`🤖 ربات قرنطینه ${SELF_BOT_ID} فعال`);
});

app.listen(PORT, () => {
  console.log(`✅ ربات قرنطینه ${SELF_BOT_ID} راه‌اندازی شد`);
});

if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => console.log('✅ Webhook تنظیم شد'))
    .catch(error => bot.launch());
} else {
  bot.launch();
  }
