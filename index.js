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

// ==================[ توابع اصلی - اصلاح شده ]==================
const isBotAdmin = async (chatId) => {
  try {
    const self = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    return ['administrator', 'creator'].includes(self.status);
  } catch (error) {
    console.log('ربات ادمین نیست');
    return false;
  }
};

const removeUserFromChat = async (chatId, userId) => {
  try {
    if (!(await isBotAdmin(chatId))) {
      console.log(`ربات در گروه ${chatId} ادمین نیست`);
      return false;
    }
    
    await bot.telegram.banChatMember(chatId, userId, {
      until_date: Math.floor(Date.now() / 1000) + 30
    });
    
    await bot.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
    console.log(`✅ کاربر ${userId} از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    console.log(`خطا در حذف کاربر ${userId}:`, error.message);
    return false;
  }
};

// ==================[ تابع قرنطینه - کاملاً بازنویسی شده ]==================
const quarantineUser = async (ctx, user) => {
  try {
    const currentChatId = ctx.chat.id.toString();
    const userId = user.id;

    console.log(`🔍 شروع قرنطینه کاربر ${userId} در گروه ${currentChatId}`);

    // 1. بررسی اینکه کاربر در همین ربات قرنطینه هست
    const { data: existingUser } = await supabase
      .from('quarantine_users')
      .select('user_id, is_quarantined, current_chat_id')
      .eq('user_id', userId)
      .single();

    if (existingUser && existingUser.is_quarantined) {
      if (existingUser.current_chat_id === currentChatId) {
        console.log(`کاربر ${userId} در همین گروه قرنطینه است - اجازه ماندن`);
        return true;
      } else {
        console.log(`کاربر ${userId} در گروه دیگر قرنطینه است - حذف از گروه فعلی`);
        await removeUserFromChat(currentChatId, userId);
        return false;
      }
    }

    // 2. بررسی سایر ربات‌های قرنطینه
    if (SYNC_ENABLED) {
      const otherBots = BOT_INSTANCES.filter(bot => bot.id !== SELF_BOT_ID && bot.type === 'quarantine');
      
      for (const botInstance of otherBots) {
        try {
          let apiUrl = botInstance.url;
          if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
          
          const response = await axios.post(`${apiUrl}/api/check-quarantine`, {
            userId: userId,
            secretKey: botInstance.secretKey || API_SECRET_KEY,
            sourceBot: SELF_BOT_ID
          }, { timeout: 6000 });

          if (response.data && response.data.isQuarantined) {
            console.log(`کاربر ${userId} در ربات ${botInstance.id} قرنطینه است - حذف`);
            await removeUserFromChat(currentChatId, userId);
            return false;
          }
        } catch (error) {
          console.log(`خطا در بررسی ربات ${botInstance.id}`);
        }
      }
    }

    // 3. قرنطینه کاربر جدید
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

    console.log(`✅ کاربر ${userId} با موفقیت قرنطینه شد`);
    return true;
    
  } catch (error) {
    console.error('❌ خطا در فرآیند قرنطینه:', error);
    return false;
  }
};

// ==================[ تابع حذف از گروه‌های محلی ]==================
const removeUserFromLocalChats = async (currentChatId, userId) => {
  try {
    const { data: allChats } = await supabase.from('allowed_chats').select('chat_id');
    if (!allChats) return;

    let removedCount = 0;
    for (const chat of allChats) {
      if (chat.chat_id.toString() === currentChatId) continue;
      
      try {
        const removed = await removeUserFromChat(chat.chat_id, userId);
        if (removed) removedCount++;
      } catch (error) {
        // کاربر در گروه نیست
      }
    }
    
    console.log(`✅ کاربر ${userId} از ${removedCount} گروه محلی حذف شد`);
  } catch (error) {
    console.error('خطا در حذف از گروه‌های محلی:', error);
  }
};

// ==================[ تابع آزادسازی کاربر ]==================
const releaseUserFromQuarantine = async (userId) => {
  try {
    console.log(`🔓 آزادسازی کاربر ${userId} از قرنطینه`);

    const { error: updateError } = await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('خطا در به‌روزرسانی دیتابیس:', updateError);
      return false;
    }
    
    cache.del(`user:${userId}`);
    
    // اطلاع به سایر ربات‌ها
    if (SYNC_ENABLED) {
      const otherBots = BOT_INSTANCES.filter(bot => 
        bot.id !== SELF_BOT_ID && bot.type === 'quarantine'
      );
      
      for (const botInstance of otherBots) {
        try {
          let apiUrl = botInstance.url;
          if (!apiUrl.startsWith('http')) apiUrl = `https://${apiUrl}`;
          
          await axios.post(`${apiUrl}/api/sync-release`, {
            userId: userId,
            secretKey: botInstance.secretKey || API_SECRET_KEY,
            sourceBot: SELF_BOT_ID
          }, { timeout: 5000 });
        } catch (error) {
          // خطا در اطلاع‌رسانی
        }
      }
    }
    
    console.log(`✅ کارب�� ${userId} از قرنطینه آزاد شد`);
    return true;
  } catch (error) {
    console.error(`خطا در آزادسازی کاربر ${userId}:`, error);
    return false;
  }
};

// ==================[ پردازش اعضای جدید ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    console.log('دریافت عضو جدید در گروه');

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

    // پردازش کاربران عادی
    const chatId = ctx.chat.id.toString();
    const { data: allowedChat } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (!allowedChat) {
      console.log('گروه فعال نیست');
      return;
    }

    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        console.log(`پردازش کاربر ${member.id} (${member.first_name})`);
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
    const { userId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { data: user } = await supabase
      .from('quarantine_users')
      .select('user_id, is_quarantined, current_chat_id')
      .eq('user_id', userId)
      .single();
      
    res.status(200).json({ 
      isQuarantined: user ? user.is_quarantined : false,
      currentChatId: user ? user.current_chat_id : null,
      botId: SELF_BOT_ID
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/sync-release', async (req, res) => {
  try {
    const { userId, secretKey } = req.body;
    
    if (!secretKey || secretKey !== API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log(`دریافت درخواست هماهنگی آزادسازی برای کاربر ${userId}`);

    await supabase
      .from('quarantine_users')
      .update({ 
        is_quarantined: false,
        current_chat_id: null
      })
      .eq('user_id', userId);

    cache.del(`user:${userId}`);
    
    res.status(200).json({ 
      success: true,
      botId: SELF_BOT_ID
    });
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
const isOwnerOrCreator = async (ctx) => {
  try {
    const userId = ctx.from.id;
    if (userId === OWNER_ID) return { hasAccess: true, isOwner: true };
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

    ctx.reply('✅ ربات با موفقیت فعال شد! کاربران جدید به طور خودکار قرنطینه می‌شوند.');
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
  res.send(`🤖 ربات قرنطینه ${SELF_BOT_ID} فعال است`);
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

process.on('unhandledRejection', (error) => {
  console.error('❌ خطای catch نشده:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ خطای مدیریت نشده:', error);
});
