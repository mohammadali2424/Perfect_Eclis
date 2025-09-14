const { Telegraf, Scenes, session } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// بررسی وجود متغیرهای محیطی
if (!process.env.BOT_TOKEN) {
  console.error('❌ ERROR: BOT_TOKEN is not set!');
  process.exit(1);
}
if (!process.env.SUPABASE_URL) {
  console.error('❌ ERROR: SUPABASE_URL is not set!');
  process.exit(1);
}
if (!process.env.SUPABASE_KEY) {
  console.error('❌ ERROR: SUPABASE_KEY is not set!');
  process.exit(1);
}

// تنظیم مالکین ربات
const BOT_OWNERS = [7495437597,8043770504]; // آی دی مالکین را اینجا قرار دهید

// مقداردهی Supabase و Telegraf
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Telegraf(process.env.BOT_TOKEN);

// کش برای ذخیره موقت داده‌ها
const userCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 دقیقه

// تابع برای بررسی وضعیت قرنطینه کاربر
async function checkUserQuarantine(userId) {
  const cacheKey = `quarantine_${userId}`;
  
  if (userCache.has(cacheKey)) {
    const cached = userCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }
  
  const { data: quarantine, error } = await supabase
    .from('user_quarantine')
    .select('*')
    .eq('user_id', userId)
    .eq('is_quarantined', true)
    .single();

  if (!error && quarantine) {
    userCache.set(cacheKey, {
      data: quarantine,
      timestamp: Date.now()
    });
    return quarantine;
  }
  
  return null;
}

// تابع برای کیک کردن کاربر از گروه
async function kickUserFromGroup(chatId, userId, reason = 'قرنطینه فعال') {
  try {
    const botMember = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
    const canKick = botMember.status === 'administrator' && botMember.can_restrict_members;
    
    if (!canKick) {
      console.log(`⚠️ ربات در گروه ${chatId} حق کیک کردن ندارد`);
      return false;
    }
    
    await bot.telegram.kickChatMember(chatId, userId);
    console.log(`✅ کاربر ${userId} از گروه ${chatId} کیک شد (${reason})`);
    
    setTimeout(async () => {
      try {
        await bot.telegram.unbanChatMember(chatId, userId);
      } catch (unbanError) {
        console.error('خطا در آنبن کردن کاربر:', unbanError);
      }
    }, 1000);
    
    return true;
  } catch (error) {
    console.error(`❌ خطا در کیک کردن کاربر ${userId}:`, error);
    return false;
  }
}

// تابع برای کیک کردن کاربر از تمام گروه‌ها به جز گروه فعلی
async function kickUserFromAllGroupsExceptCurrent(userId, currentChatId) {
  try {
    const { data: groups, error: groupsError } = await supabase
      .from('groups')
      .select('chat_id, title')
      .eq('is_bot_admin', true);

    if (groupsError) {
      console.error('Error fetching groups:', groupsError);
      return 0;
    }

    if (!groups || groups.length === 0) {
      return 0;
    }
    
    let kickedCount = 0;
    
    for (const group of groups) {
      if (group.chat_id !== currentChatId) {
        const kicked = await kickUserFromGroup(group.chat_id, userId, 'قرنطینه فعال - انتقال به گروه جدید');
        if (kicked) kickedCount++;
      }
    }
    
    console.log(`✅ کاربر ${userId} از ${kickedCount} گروه کیک شد`);
    return kickedCount;
  } catch (error) {
    console.error('Error kicking user from all groups:', error);
    return 0;
  }
}

// تابع برای ذخیره‌سازی پیام با entities و فرمت‌ها
async function saveMessageWithEntities(messageText, messageEntities) {
  if (!messageEntities || messageEntities.length === 0) {
    return { text: messageText, entities: [] };
  }

  const entities = messageEntities.map(entity => {
    const baseEntity = {
      type: entity.type,
      offset: entity.offset,
      length: entity.length
    };
    
    if (entity.url) baseEntity.url = entity.url;
    if (entity.user) baseEntity.user = entity.user;
    if (entity.language) baseEntity.language = entity.language;
    if (entity.custom_emoji_id) baseEntity.custom_emoji_id = entity.custom_emoji_id;
    
    return baseEntity;
  });

  return { text: messageText, entities };
}

// تابع برای ارسال پیام با حفظ entities و فرمت‌ها
async function sendFormattedMessage(chatId, text, entities, replyToMessageId = null) {
  try {
    const messageOptions = {
      parse_mode: entities && entities.length > 0 ? undefined : 'HTML',
      disable_web_page_preview: false
    };

    if (replyToMessageId) {
      messageOptions.reply_to_message_id = replyToMessageId;
    }

    if (entities && entities.length > 0) {
      messageOptions.entities = entities;
    }

    await bot.telegram.sendMessage(chatId, text, messageOptions);
    return true;
  } catch (error) {
    console.error('Error sending formatted message:', error);
    
    // Fallback: ارسال بدون entities
    try {
      await bot.telegram.sendMessage(
        chatId,
        text,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: false,
          reply_to_message_id: replyToMessageId
        }
      );
      return true;
    } catch (fallbackError) {
      console.error('Fallback message sending also failed:', fallbackError);
      return false;
    }
  }
}

// تابع برای تبدیل ثانیه به فرمت خوانا
function formatDelayTime(seconds) {
  if (seconds < 60) {
    return `${seconds} ثانیه`;
  } else {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 
      ? `${minutes} دقیقه و ${remainingSeconds} ثانیه` 
      : `${minutes} د��یقه`;
  }
}

// تابع برای بررسی دسترسی ربات در گروه
async function checkBotAdminStatus(chatId) {
  try {
    const cacheKey = `bot_admin_${chatId}`;
    if (userCache.has(cacheKey)) {
      const cached = userCache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
      }
    }

    // بررسی مستقیم از تلگرام
    try {
      const botMember = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
      const isAdmin = botMember.status === 'administrator' && botMember.can_restrict_members;
      
      // ذخیره در دیتابیس
      await supabase
        .from('groups')
        .upsert({
          chat_id: chatId,
          is_bot_admin: isAdmin,
          last_updated: new Date().toISOString()
        }, {
          onConflict: 'chat_id'
        });

      userCache.set(cacheKey, isAdmin);
      return isAdmin;
    } catch (tgError) {
      console.error('Error checking bot admin status:', tgError);
      return false;
    }
  } catch (error) {
    console.error('Error in checkBotAdminStatus:', error);
    return false;
  }
}

// تابع اصلی قرنطینه خودکار
async function autoQuarantineUser(userId, chatId, userInfo) {
  try {
    // بررسی دسترسی ربات در این گروه
    const isBotAdmin = await checkBotAdminStatus(chatId);
    if (!isBotAdmin) {
      console.log(`⚠️ ربات در گروه ${chatId} ادمین نیست، نمی‌تواند کاربر را قرنطینه کند`);
      return false;
    }

    // ثبت اطلاعات کاربر در دیتابیس
    await supabase
      .from('users')
      .upsert({
        user_id: userId,
        first_name: userInfo.first_name,
        username: userInfo.username,
        last_name: userInfo.last_name,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });

    // بررسی قرنطینه کاربر
    const quarantine = await checkUserQuarantine(userId);
    
    if (quarantine && quarantine.chat_id !== chatId) {
      await kickUserFromGroup(chatId, userId, 'کاربر در قرنطینه است');
      return true;
    }
    
    // قرنطینه خودکار کاربر
    await supabase
      .from('user_quarantine')
      .upsert({
        user_id: userId,
        chat_id: chatId,
        is_quarantined: true,
        username: userInfo.username,
        first_name: userInfo.first_name,
        last_name: userInfo.last_name,
        quarantine_start: new Date().toISOString(),
        quarantine_end: null
      }, {
        onConflict: 'user_id'
      });

    userCache.delete(`quarantine_${userId}`);
    await kickUserFromAllGroupsExceptCurrent(userId, chatId);
    
    console.log(`✅ کاربر ${userId} به طور خودکار قرنطینه شد`);
    return true;
    
  } catch (error) {
    console.error('Error in auto quarantine:', error);
    return false;
  }
}

// تعریف سناریو برای تنظیمات تریگر (Wizard)
const setTriggerWizard = new Scenes.WizardScene(
  'set_trigger_wizard',
  async (ctx) => {
    await ctx.reply('🤖 لطفاً نام تریگر را وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.triggerName = ctx.message.text;
    await ctx.reply('⏰ لطفاً زمان تاخیر به ثانیه وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const delaySeconds = parseInt(ctx.message.text);
    if (isNaN(delaySeconds) || delaySeconds <= 0) {
      await ctx.reply('⚠️ زمان باید یک عدد مثبت باشد. لطفاً دوباره وارد کنید:');
      return;
    }
    
    ctx.wizard.state.delaySeconds = delaySeconds;
    await ctx.reply('📩 لطفاً پیام تاخیری را وارد کنید (می‌توانید از لینک و فرمت استفاده کنید):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    // ذخیره پیام تاخیری با entities
    ctx.wizard.state.secondMessage = ctx.message.text;
    ctx.wizard.state.secondMessageData = await saveMessageWithEntities(
      ctx.message.text,
      ctx.message.entities || ctx.message.caption_entities
    );
    
    // ذخیره در دیتابیس
    const { error } = await supabase
      .from('trigger_settings')
      .upsert({
        chat_id: ctx.chat.id,
        trigger_name: ctx.wizard.state.triggerName,
        delay_seconds: ctx.wizard.state.delaySeconds,
        second_message: ctx.wizard.state.secondMessageData.text,
        second_message_entities: ctx.wizard.state.secondMessageData.entities
      });

    if (error) {
      console.error('Error saving trigger settings:', error);
      await ctx.reply('❌ خطا در ذخیره تنظیمات.');
    } else {
      const formattedDelay = formatDelayTime(ctx.wizard.state.delaySeconds);
      await ctx.replyWithHTML(`✅ تنظیمات تریگر با موفقیت ذخیره شد!\n\n📋 خلاصه تنظیمات:\n<b>نام:</b> ${ctx.wizard.state.triggerName}\n<b>تاخیر:</b> ${formattedDelay}`);
    }
    
    return ctx.scene.leave();
  }
);

// ثبت سناریو
const stage = new Scenes.Stage([setTriggerWizard]);
bot.use(session());
bot.use(stage.middleware());

// هندلر جدید برای #فعال - ثبت گروه توسط ادمین
bot.hears(/.*#فعال.*/, async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const chatType = ctx.chat.type;
    const chatTitle = ctx.chat.title || 'بدون نام';

    if (chatType !== 'group' && chatType !== 'supergroup') {
      return ctx.reply('❌ این دستور فقط در گروه‌ها قابل استفاده است.');
    }

    try {
      const chatMember = await ctx.telegram.getChatMember(chatId, userId);
      const isAdmin = ['administrator', 'creator'].includes(chatMember.status);
      
      if (!isAdmin) {
        return ctx.reply('❌ فقط ادمین‌های گروه می‌توانند از این دستور استفاده کنند.');
      }
    } catch (error) {
      console.error('Error checking admin status:', error);
      return ctx.reply('❌ خطا در بررسی وضعیت ادمینی.');
    }

    // بررسی دسترسی ربات در گروه
    const botMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
    const isBotAdmin = botMember.status === 'administrator' && botMember.can_restrict_members;

    const { error } = await supabase
      .from('groups')
      .upsert({
        chat_id: chatId,
        title: chatTitle,
        type: chatType,
        is_bot_admin: isBotAdmin,
        last_updated: new Date().toISOString()
      }, {
        onConflict: 'chat_id'
      });

    if (error) {
      console.error('Error saving group:', error);
      return ctx.reply('❌ خطا در ثبت گروه. لطفاً بعداً تلاش کنید.');
    }

    await ctx.reply(`✅ گروه "${chatTitle}" با موفقیت در سیستم ثبت شد!`);

  } catch (error) {
    console.error('Error in #فعال command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// هندلر تقویت شده برای زمانی که ربات به گروهی اضافه می‌شود
bot.on('my_chat_member', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const newStatus = ctx.update.my_chat_member.new_chat_member.status;
    const chatTitle = ctx.chat.title || 'بدون نام';
    const chatType = ctx.chat.type;

    if (chatType === 'group' || chatType === 'supergroup') {
      // بررسی آیا ربات ادمین است
      const isBotAdmin = newStatus === 'administrator';
      
      const { error } = await supabase
        .from('groups')
        .upsert({
          chat_id: chatId,
          title: chatTitle,
          type: chatType,
          is_bot_admin: isBotAdmin,
          last_updated: new Date().toISOString()
        }, {
          onConflict: 'chat_id'
        });

      if (error) {
        console.error('Error saving group:', error);
      } else {
        console.log(`✅ گروه ذخیره شد: ${chatTitle} (${chatId}) - وضعیت ادمین: ${isBotAdmin}`);
        
        // پاکسازی کش وضعیت ربات
        userCache.delete(`bot_admin_${chatId}`);
      }
    }
  } catch (error) {
    console.error('Error in my_chat_member handler:', error);
  }
});

// هندلر تقویت شده برای کاربران جدید - قرنطینه کاملاً خودکار
bot.on('new_chat_members', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    
    for (const newMember of ctx.message.new_chat_members) {
      const userId = newMember.id;
      
      if (newMember.is_bot) continue;

      // قرنطینه خودکار کاربر
      await autoQuarantineUser(userId, chatId, {
        first_name: newMember.first_name,
        username: newMember.username,
        last_name: newMember.last_name
      });
    }
  } catch (error) {
    console.error('Error in new_chat_members handler:', error);
  }
});

// هندلر برای بررسی کاربران قرنطینه هنگام تغییر وضعیت
bot.on('chat_member', async (ctx) => {
  try {
    const newMember = ctx.update.chat_member.new_chat_member;
    const userId = newMember.user.id;
    const chatId = ctx.chat.id;
    
    // فقط زمانی که کاربر به عنوان عضو جدید اضافه می‌شود
    if (newMember.status === 'member' || newMember.status === 'administrator') {
      // بررسی آیا کاربر در قرنطینه است
      const quarantine = await checkUserQuarantine(userId);
      
      if (quarantine && quarantine.chat_id !== chatId) {
        // بررسی دسترسی ربات
        const isBotAdmin = await checkBotAdminStatus(chatId);
        if (isBotAdmin) {
          await kickUserFromGroup(chatId, userId, 'کاربر در قرنطینه است');
        }
      }
    }
  } catch (error) {
    console.error('Error in chat_member handler:', error);
  }
});

// دستور start
bot.start(async (ctx) => {
  try {
    const chatId = ctx.message.chat.id;
    const firstName = ctx.message.chat.first_name || 'کاربر';
    const username = ctx.message.chat.username;

    // ثبت کاربر در دیتابیس
    await supabase
      .from('users')
      .upsert({
        user_id: chatId,
        first_name: firstName,
        username: username,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });

    await ctx.reply(`سلام ${firstName}! 😊`);

    // پیام برای مالکین
    if (BOT_OWNERS.includes(ctx.from.id)) {
      await ctx.replyWithHTML(`
🤖 <b>دستورات disponibles:</b>
/set_trigger - تنظیم تریگر ��دید
#فعال - ثبت گروه در سیستم (فقط ادمین)
/list_triggers - مشاهده لیست تریگرها
/delete_trigger - حذف تریگر
/group_status - بررسی وضعیت گروه
/admin_g - تنظیم گروه به عنوان ادمین در دیتابیس
/remove_group - حذف گروه از دیتابیس
      `);
    }

  } catch (err) {
    console.error('Error in /start command:', err);
    ctx.reply('❌ خطای غیرمنتظره‌ای رخ داد.');
  }
});

// دستور set_trigger - شروع فرآیند تنظیمات
bot.command('set_trigger', (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }
  ctx.scene.enter('set_trigger_wizard');
});

// تشخیص #ورود در هر جای متن
bot.hears(/.*#ورود.*/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const firstName = ctx.from.first_name || 'کاربر';
    const chatTitle = ctx.chat.title || 'منطقه';

    const { data: settings, error: settingsError } = await supabase
      .from('trigger_settings')
      .select('*')
      .eq('chat_id', chatId)
      .single();

    if (settingsError || !settings) {
      return ctx.reply('❌ تنظیمات تریگر یافت نشد. لطفاً ابتدا از /set_trigger استفاده کنید.');
    }

    const { trigger_name, delay_seconds, second_message, second_message_entities } = settings;

    // قرنطینه کاربر
    await autoQuarantineUser(userId, chatId, {
      first_name: ctx.from.first_name,
      username: ctx.from.username,
      last_name: ctx.from.last_name
    });

    // ارسال پیام اول (ثابت)
    const formattedDelay = formatDelayTime(delay_seconds);
    await ctx.replyWithHTML(
      `پلیر <b>${firstName}</b> وارد منطقه <b>${chatTitle}</b> شد.\n\n⏳┊مدت زمان سفر : ${formattedDelay}`,
      { reply_to_message_id: ctx.message.message_id }
    );

    // ارسال پیام دوم با تاخیر (با حفظ فرمت و لینک‌ها)
    setTimeout(async () => {
      try {
        await sendFormattedMessage(
          chatId,
          second_message,
          second_message_entities,
          ctx.message.message_id
        );
      } catch (error) {
        console.error('Error sending delayed message:', error);
      }
    }, delay_seconds * 1000);

  } catch (error) {
    console.error('Error in #ورود command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// تشخیص #خروج در هر جای متن - غیرفعال کردن قرنطینه
bot.hears(/.*#خروج.*/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || 'پلیر';

    // بررسی وجود کاربر در قرنطینه
    const { data: quarantine, error: checkError } = await supabase
      .from('user_quarantine')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!quarantine) {
      return ctx.reply('❌ شما در حال حاضر در قرنطینه نیستید.');
    }

    // به روز رسانی وضعیت قرنطینه کاربر
    const { error: updateError } = await supabase
      .from('user_quarantine')
      .update({ 
        is_quarantined: false, 
        quarantine_end: new Date().toISOString() 
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('Error updating quarantine status:', updateError);
      return ctx.reply('❌ خطا در به روز رسانی وضعیت قرنطینه.');
    }

    // پاکسازی کش
    userCache.delete(`quarantine_${userId}`);
    
    // ارسال پیام خروج
    await ctx.replyWithHTML(`🧭┊سفر به سلامت <b>${firstName}</b>`);
    
  } catch (error) {
    console.error('Error in #خروج command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// دستور برای نمایش لیست تریگرها
bot.command('list_triggers', async (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }

  try {
    const chatId = ctx.chat.id;
    
    const { data: triggers, error } = await supabase
      .from('trigger_settings')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (error || !triggers || triggers.length === 0) {
      return ctx.reply('❌ هیچ تریگری برای این گروه ثبت نشده است.');
    }

    let message = '📋 لیست تریگرهای این گروه:\n\n';
    
    triggers.forEach((trigger, index) => {
      const formattedDelay = formatDelayTime(trigger.delay_seconds);
      message += `${index + 1}. ${trigger.trigger_name}\n`;
      message += `   ⏰ تاخیر: ${formattedDelay}\n`;
      message += `   📅 تاریخ ایجاد: ${new Date(trigger.created_at).toLocaleDateString('fa-IR')}\n\n`;
    });

    await ctx.reply(message);
  } catch (error) {
    console.error('Error in /list_triggers command:', error);
    ctx.reply('❌ خطایی در دریافت لیست تریگرها رخ داد.');
  }
});

// دستور برای حذف تریگر
bot.command('delete_trigger', async (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }

  try {
    const chatId = ctx.chat.id;
    const params = ctx.message.text.split(' ');
    
    if (params.length < 2) {
      return ctx.reply('⚠️ لطفاً نام تریگر را مشخص کنید. فرمت: /delete_trigger <نام تریگر>');
    }

    const triggerName = params.slice(1).join(' ');

    const { error } = await supabase
      .from('trigger_settings')
      .delete()
      .eq('chat_id', chatId)
      .eq('trigger_name', triggerName);

    if (error) {
      console.error('Error deleting trigger:', error);
      return ctx.reply('❌ خطا در حذف تریگر. لطفاً نام تریگر را بررسی کنید.');
    }

    await ctx.reply(`✅ تریگر "${triggerName}" با موفقیت حذف شد.`);
  } catch (error) {
    console.error('Error in /delete_trigger command:', error);
    ctx.reply('❌ خطایی در حذف تریگر رخ داد.');
  }
});

// دستور برای بررسی وضعیت گروه
bot.command('group_status', async (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }

  try {
    const chatId = ctx.chat.id;
    
    const [dbStatus, botStatus] = await Promise.all([
      supabase
        .from('groups')
        .select('*')
        .eq('chat_id', chatId)
        .single(),
      
      bot.telegram.getChatMember(chatId, bot.botInfo.id)
    ]);

    let message = `📊 وضعیت گروه ${ctx.chat.title || 'بدون نام'}:\n\n`;
    
    if (!dbStatus.error && dbStatus.data) {
      message += `🗄️ وضعیت دیتابیس: ${dbStatus.data.is_bot_admin ? 'ادمین ✅' : 'غیر ادمین ❌'}\n`;
    } else {
      message += `🗄️ وضعیت دیتابیس: ثبت نشده ❌\n`;
    }
    
    message += `🤖 وضعیت واقعی: ${['administrator', 'creator'].includes(botStatus.status) ? 'ادمین ✅' : 'غیر ادمین ❌'}\n`;
    
    await ctx.reply(message);
  } catch (error) {
    console.error('Error in group_status command:', error);
    ctx.reply('❌ خطا در بررسی وضعیت گروه');
  }
});

// دستور برای تنظیم گروه به عنوان ادمین در دیتابیس
bot.command('admin_g', async (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }

  try {
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    
    if (chatType !== 'group' && chatType !== 'supergroup') {
      return ctx.reply('❌ این دستور فقط در گروه‌ها قابل استفاده است.');
    }

    // بررسی وضعیت واقعی ربات در گروه
    const botMember = await ctx.telegram.getChatMember(chatId, bot.botInfo.id);
    const isBotAdmin = botMember.status === 'administrator' && botMember.can_restrict_members;
    
    if (!isBotAdmin) {
      return ctx.reply('❌ ربات باید ابتدا در گروه ادمین شود سپس از این دستور استفاده کنید.');
    }

    // به روز رسانی وضعیت گروه در دیتابیس
    const { error } = await supabase
      .from('groups')
      .upsert({
        chat_id: chatId,
        title: ctx.chat.title || 'بدون نام',
        type: chatType,
        is_bot_admin: true,
        last_updated: new Date().toISOString()
      }, {
        onConflict: 'chat_id'
      });

    if (error) {
      console.error('Error updating group status:', error);
      return ctx.reply('❌ خطا در به روز رسانی وضعیت گروه.');
    }

    // پاکسازی کش
    userCache.delete(`bot_admin_${chatId}`);
    
    await ctx.reply('✅ گروه با موفقیت در دیتابیس به عنوان ادمین ثبت شد!');
    
  } catch (error) {
    console.error('Error in /admin_g command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// دستور برای حذف گروه از دیتابیس
bot.command('remove_group', async (ctx) => {
  if (!BOT_OWNERS.includes(ctx.from.id)) {
    return ctx.reply('❌ فقط مالک ربات می‌تواند از این دستور استفاده کند.');
  }

  try {
    const chatId = ctx.chat.id;
    
    const { error } = await supabase
      .from('groups')
      .delete()
      .eq('chat_id', chatId);

    if (error) {
      console.error('Error deleting group:', error);
      return ctx.reply('❌ خطا در حذف گروه از دیتابیس.');
    }

    // پاکسازی کش
    userCache.delete(`bot_admin_${chatId}`);
    
    await ctx.reply('✅ گروه با موفقیت از دیتابیس حذف شد!');
    
  } catch (error) {
    console.error('Error in /remove_group command:', error);
    ctx.reply('❌ خطایی در حذف گروه رخ داد.');
  }
});

// middleware برای پردازش JSON
app.use(express.json());

// مسیر webhook
app.post('/webhook', async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
  } catch (error) {
    console.error('Error handling update:', error);
    res.status(200).send();
  }
});

// راه‌اندازی سرور
app.listen(PORT, () => {
  console.log(`🤖 ربات در پورت ${PORT} راه‌اندازی شد...`);
});