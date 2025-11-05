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

const cache = new NodeCache({
  stdTTL: 900,
  checkperiod: 300,
  maxKeys: 5000,
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

// ==================[ پینگ ]==================
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) return;

  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  const performPing = async () => {
    try {
      await axios.head(`${selfUrl}/ping`, { timeout: 5000 });
    } catch (error) {
      setTimeout(performPing, 60000);
    }
  };

  setTimeout(performPing, 30000);
  setInterval(performPing, PING_INTERVAL);
};

app.head('/ping', (req, res) => res.status(200).end());
app.get('/ping', (req, res) => {
  res.status(200).json({ status: 'active', bot: SELF_BOT_ID });
});

// ==================[ توابع اصلی ]==================
const checkOwnerAccess = (ctx) => {
  const userId = ctx.from.id;
  if (userId !== OWNER_ID) {
    return {
      hasAccess: false,
      message: '🚫 شما مالک اکلیس نیستی ، حق استفاده از بات این مجموعه رو نداری ، حدتو بدون',
    };
  }
  return { hasAccess: true };
};

const isBotAdmin = async (chatId) => {
  try {
    const cacheKey = `admin_${chatId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const chatMember = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    const isAdmin = ['administrator', 'creator'].includes(chatMember.status);

    cache.set(cacheKey, isAdmin, 300);
    return isAdmin;
  } catch (error) {
    console.log(`❌ خطا در بررسی ادمین:`, error.message);
    cache.set(`admin_${chatId}`, false, 60);
    return false;
  }
};

const removeUserFromChat = async (chatId, userId) => {
  try {
    const adminStatus = await isBotAdmin(chatId);
    if (!adminStatus) {
      console.log(`❌ ربات در گروه ${chatId} ادمین نیست`);
      return false;
    }

    let userStatus;
    try {
      const member = await bot.telegram.getChatMember(chatId, userId);
      userStatus = member.status;
    } catch (error) {
      console.log(`✅ کاربر ${userId} از قبل در گروه نیست`);
      return true;
    }

    if (['left', 'kicked'].includes(userStatus)) {
      console.log(`✅ کاربر ${userId} از قبل حذف شده`);
      return true;
    }

    if (userStatus === 'creator') {
      console.log(`❌ کاربر ${userId} سازنده گروه است`);
      return false;
    }

    await bot.telegram.banChatMember(chatId, userId);

    // Adding a delay before unbanning the user
    setTimeout(async () => {
      try {
        await bot.telegram.unbanChatMember(chatId, userId);
      } catch (error) {
        console.log(`❌ خطا در انبن کردن کاربر ${userId}:`, error.message);
      }
    }, 5000); // 5 seconds delay to ensure ban removal works properly

    console.log(`✅ کاربر ${userId} از گروه ${chatId} حذف شد`);
    return true;
  } catch (error) {
    console.log(`❌ خطا در حذف کاربر:`, error.message);
    return false;
  }
};

const quarantineUser = async (ctx, user) => {
  try {
    const currentChatId = ctx.chat.id.toString();
    const userId = user.id;

    console.log(`🔍 شروع فرآیند قرنطینه برای کاربر ${userId} در گروه ${currentChatId}`);

    const status = await getUserQuarantineStatus(userId);

    // If the user is already quarantined in the current chat, don't quarantine again
    if (status.isQuarantined) {
      if (status.currentChatId === currentChatId) {
        console.log(`✅ کاربر ${userId} در گروه مجاز خودش هست`);
        return true;
      } else {
        console.log(`🚫 کاربر ${userId} در گروه اشتباهی هست - حذف کردن`);
        await removeUserFromChat(currentChatId, userId);
        return false;
      }
    }

    console.log(`🔒 قرنطینه کردن کاربر جدید ${userId} در گروه ${currentChatId}`);

    const userData = {
      user_id: userId,
      username: user.username,
      first_name: user.first_name,
      is_quarantined: true,
      current_chat_id: currentChatId,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('quarantine_users')
      .upsert(userData, { onConflict: 'user_id' });

    if (error) {
      console.log('❌ خطا در ذخیره کاربر در دیتابیس:', error);
      return false;
    }

    cache.del(`user_${userId}`);

    // Remove user from other groups
    const removedCount = await removeFromOtherChats(currentChatId, userId);

    console.log(`✅ کاربر ${userId} با موفقیت در دیتابیس مرکزی قرنطینه شد`);
    console.log(`🗑️ از ${removedCount} گروه دیگر حذف شد`);

    return true;
  } catch (error) {
    console.log('❌ خطا در فرآیند قرنطینه:', error);
    return false;
  }
};

// ==================[ پردازش اعضای جدید ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    console.log('👥 دریافت عضو جدید در گروه');

    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot && member.id === ctx.botInfo.id) {
        const addedBy = ctx.message.from;

        if (addedBy.id !== OWNER_ID) {
          console.log(`🚫 کاربر ${addedBy.id} مالک نیست - لفت دادن از گروه`);
          await ctx.reply('🚫 شما مالک اکلیس نیستی ، حق استفاده از بات این مجموعه رو نداری ، حدتو بدون');
          await ctx.leaveChat();
          return;
        }

        console.log(`✅ ربات توسط مالک ${addedBy.id} اضافه شد`);
        await ctx.reply('✅ ربات با موفقیت اضافه شد! از /on برای فعال‌سازی استفاده کنید.');
        return;
      }
    }

    const chatId = ctx.chat.id.toString();
    const { data: allowedChat } = await supabase
      .from('allowed_chats')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (!allowedChat) {
      console.log('⚠️ گروه در لیست فعال نیست - پردازش کاربران جدید انجام نمی‌شود');
      return;
    }

    console.log('✅ گروه فعال است - پردازش کاربران جدید...');

    for (const member of ctx.message.new_chat_members) {
      if (!member.is_bot) {
        console.log(`🔍 پردازش کاربر ${member.id} (${member.first_name})`);
        await quarantineUser(ctx, member);
      }
    }

  } catch (error) {
    console.log('❌ خطا در پردازش عضو جدید:', error);
  }
});

// ==================[ راه‌اندازی سرور ]==================
app.use(bot.webhookCallback('/webhook'));

app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 ربات قرنطینه ${SELF_BOT_ID}</h1>
    <p>ربات فعال است - فقط مالک می‌تواند استفاده کند</p>
    <p>مالک: ${OWNER_ID}</p>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 ربات قرنطینه ${SELF_BOT_ID} راه‌اندازی شد`);
  console.log(`👤 مالک ربات: ${OWNER_ID}`);
  console.log(`🔑 کلید API: ${API_SECRET_KEY ? 'تنظیم شده' : 'تنظیم نشده'}`);
  startAutoPing();
});

if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => console.log('✅ Webhook تنظیم شد'))
    .catch(error => {
      console.log('❌ خطا در تنظیم Webhook:', error.message);
      bot.launch();
    });
} else {
  bot.launch();
}

process.on('unhandledRejection', (error) => {
  console.log('❌ خطای catch نشده:', error.message);
});
