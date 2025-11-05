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

// ==================[ دستور /start ]==================
bot.start((ctx) => {
  ctx.reply('نینجا در خدمت شماست 🥷🏻');
});

// ==================[ چک کردن دسترسی مالک ]==================
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

// ==================[ چک کردن ادمین بودن ربات ]==================
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

// ==================[ افزودن گروه به لیست مجاز ]==================
bot.command('on', async (ctx) => {
  try {
    const chatId = ctx.chat.id.toString();
    const chatTitle = ctx.chat.title || 'بدون عنوان';

    console.log(`🔧 درخواست فعال‌سازی گروه ${chatTitle} (${chatId})`);

    const { error } = await supabase
      .from('allowed_chats')
      .upsert({
        chat_id: chatId,
        chat_title: chatTitle,
        created_at: new Date().toISOString(),
      }, { onConflict: 'chat_id' });

    if (error) {
      console.log('❌ خطا در ذخیره گروه در دیتابیس:', error);
      return;
    }

    console.log(`✅ گروه ${chatTitle} با موفقیت فعال شد`);
    ctx.reply('✅ ربات با موفقیت فعال شد! کاربران جدید به طور خودکار قرنطینه می‌شوند.');
  } catch (error) {
    console.log('❌ خطا در فعال‌سازی گروه:', error);
    ctx.reply('❌ خطا در فعال‌سازی گروه. لطفاً دوباره تلاش کنید.');
  }
});

// ==================[ پردازش اعضای جدید ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    console.log('👥 دریافت عضو جدید در گروه');

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

// ==================[ قرنطینه کاربر ]==================
const quarantineUser = async (ctx, user) => {
  try {
    const currentChatId = ctx.chat.id.toString();
    const userId = user.id;

    console.log(`🔍 شروع فرآیند قرنطینه برای کاربر ${userId} در گروه ${currentChatId}`);

    const status = await getUserQuarantineStatus(userId);

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
    const removedCount = await removeFromOtherChats(currentChatId, userId);

    console.log(`✅ کاربر ${userId} با موفقیت در دیتابیس مرکزی قرنطینه شد`);
    console.log(`🗑️ از ${removedCount} گروه دیگر حذف شد`);

    return true;
  } catch (error) {
    console.log('❌ خطا در فرآیند قرنطینه:', error);
    return false;
  }
};

// ==================[ وضعیت قرنطینه کاربر ]==================
const getUserQuarantineStatus = async (userId) => {
  const cacheKey = `user_${userId}`;
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  try {
    const { data, error } = await supabase
      .from('quarantine_users')
      .select('is_quarantined, current_chat_id')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.log(`❌ خطا در دریافت وضعیت کاربر ${userId}:`, error);
      return { isQuarantined: false, currentChatId: null };
    }

    const result = data ? {
      isQuarantined: data.is_quarantined,
      currentChatId: data.current_chat_id
    } : { isQuarantined: false, currentChatId: null };

    cache.set(cacheKey, result, 600);
    return result;

  } catch (error) {
    console.log(`❌ خطا در دریافت وضعیت کاربر ${userId}:`, error);
    return { isQuarantined: false, currentChatId: null };
  }
};

// ==================[ حذف از گروه‌های غیرمجاز ]==================
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

// ==================[ راه‌اندازی سرور ]==================
app.listen(PORT, () => {
  console.log(`🚀 ربات قرنطینه ${SELF_BOT_ID} راه‌اندازی شد`);
  bot.launch();
});
