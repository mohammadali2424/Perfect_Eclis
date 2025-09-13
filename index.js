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
async function kickUserFromGroup(ctx, chatId, userId, reason = 'قرنطینه فعال') {
  try {
    const botMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
    const canKick = botMember.status === 'administrator' && botMember.can_restrict_members;
    
    if (!canKick) {
      console.log(`⚠️ ربات در گروه ${chatId} حق کیک کردن ندارد`);
      return false;
    }
    
    await ctx.telegram.kickChatMember(chatId, userId);
    console.log(`✅ کاربر ${userId} از گروه ${chatId} کیک شد (${reason})`);
    
    setTimeout(async () => {
      try {
        await ctx.telegram.unbanChatMember(chatId, userId);
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
async function kickUserFromAllGroupsExceptCurrent(ctx, userId, currentChatId) {
  try {
    const { data: groups, error: groupsError } = await supabase
      .from('groups')
      .select('chat_id, title')
      .eq('is_bot_admin', true);

    if (!groupsError && groups && groups.length > 0) {
      let kickedCount = 0;
      
      for (const group of groups) {
        if (group.chat_id !== currentChatId) {
          const kicked = await kickUserFromGroup(ctx, group.chat_id, userId, 'قرنطینه فعال - انتقال به گروه جدید');
          if (kicked) kickedCount++;
        }
      }
      
      console.log(`✅ کاربر ${userId} از ${kickedCount} گروه کیک شد`);
      return kickedCount;
    }
    return 0;
  } catch (error) {
    console.error('Error kicking user from all groups:', error);
    return 0;
  }
}

// تابع برای ذخیره‌سازی پیام با entities
async function saveMessageWithEntities(messageText, messageEntities) {
  if (!messageEntities || messageEntities.length === 0) {
    return { text: messageText, entities: [] };
  }

  const entities = messageEntities.map(entity => ({
    type: entity.type,
    offset: entity.offset,
    length: entity.length,
    url: entity.url || null,
    user: entity.user || null,
    language: entity.language || null
  }));

  return { text: messageText, entities };
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
    ctx.wizard.state.delaySeconds = parseInt(ctx.message.text);
    if (isNaN(ctx.wizard.state.delaySeconds)) {
      await ctx.reply('⚠️ زمان باید یک عدد باشد. لطفاً دوباره وارد کنید:');
      return;
    }
    await ctx.reply('📝 لطفاً پیام اول را وارد کنید (می‌توانید از لینک استفاده کنید):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    // ذخیره متن و entities پیام اول
    ctx.wizard.state.firstMessage = ctx.message.text;
    ctx.wizard.state.firstMessageData = await saveMessageWithEntities(
      ctx.message.text,
      ctx.message.entities
    );
    
    await ctx.reply('📩 لطفاً پیام تاخیری را وارد کنید (می‌توانید از لینک استفاده کنید):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    // ذخیره متن و entities پیام دوم
    ctx.wizard.state.secondMessage = ctx.message.text;
    ctx.wizard.state.secondMessageData = await saveMessageWithEntities(
      ctx.message.text,
      ctx.message.entities
    );
    
    const { error } = await supabase
      .from('trigger_settings')
      .upsert({
        chat_id: ctx.chat.id,
        trigger_name: ctx.wizard.state.triggerName,
        first_message: ctx.wizard.state.firstMessageData.text,
        first_message_entities: ctx.wizard.state.firstMessageData.entities,
        delay_seconds: ctx.wizard.state.delaySeconds,
        second_message: ctx.wizard.state.secondMessageData.text,
        second_message_entities: ctx.wizard.state.secondMessageData.entities
      });

    if (error) {
      console.error('Error saving trigger settings:', error);
      await ctx.reply('❌ خطا در ذخیره تنظیمات.');
    } else {
      await ctx.replyWithHTML(`✅ تنظیمات تریگر با موفقیت ذخیره شد!\n\n📋 خلاصه تنظیمات:\n<b>نام:</b> ${ctx.wizard.state.triggerName}\n<b>تاخیر:</b> ${ctx.wizard.state.delaySeconds} ثانیه`);
    }
    
    return ctx.scene.leave();
  }
);

// ثبت سناریو
const stage = new Scenes.Stage([setTriggerWizard]);
bot.use(session());
bot.use(stage.middleware());

// 🔥 هندلر جدید برای #فعال - ثبت گروه توسط ادمین
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

    const { error } = await supabase
      .from('groups')
      .upsert({
        chat_id: chatId,
        title: chatTitle,
        type: chatType,
        is_bot_admin: true,
        last_updated: new Date().toISOString()
      });

    if (error) {
      console.error('Error saving group:', error);
      return ctx.reply('❌ خطا در ثبت گروه. لطفاً بعداً تلاش کنید.');
    }

    await ctx.reply(`✅ گروه "${chatTitle}" با موفقیت در سیستم ثبت شد!\n\n🔹 آی‌دی گروه: ${chatId}\n🔹 نوع گروه: ${chatType}\n🔹 وضعیت ربات: ادمین`);

  } catch (error) {
    console.error('Error in #فعال command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// هندلر برای زمانی که ربات به گروهی اضافه می‌شود یا وضعیتش تغییر می‌کند
bot.on('my_chat_member', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const newStatus = ctx.update.my_chat_member.new_chat_member.status;
    const chatTitle = ctx.chat.title || 'بدون نام';
    const chatType = ctx.chat.type;

    if (chatType === 'group' || chatType === 'supergroup') {
      if (newStatus === 'administrator') {
        const { error } = await supabase
          .from('groups')
          .upsert({
            chat_id: chatId,
            title: chatTitle,
            type: chatType,
            is_bot_admin: true,
            last_updated: new Date().toISOString()
          });

        if (error) {
          console.error('Error saving group:', error);
        } else {
          console.log(`✅ گروه ذخیره شد: ${chatTitle} (${chatId}) - ربات ادمین است`);
        }
      } else if (newStatus === 'member') {
        const { error } = await supabase
          .from('groups')
          .upsert({
            chat_id: chatId,
            title: chatTitle,
            type: chatType,
            is_bot_admin: false,
            last_updated: new Date().toISOString()
          });

        if (error) {
          console.error('Error updating group:', error);
        } else {
          console.log(`⚠️ گروه ذخیره شد: ${chatTitle} (${chatId}) - ربات عضو است (غیر ادمین)`);
        }
      } else if (newStatus === 'kicked' || newStatus === 'left') {
        const { error } = await supabase
          .from('groups')
          .delete()
          .eq('chat_id', chatId);

        if (error) {
          console.error('Error deleting group:', error);
        } else {
          console.log(`🗑️ گروه حذف شد: ${chatId}`);
        }
      }
    }
  } catch (error) {
    console.error('Error in my_chat_member handler:', error);
  }
});

// 🔥 هندلر جدید: قرنطینه خودکار کاربران هنگام ورود به هر گروهی
bot.on('new_chat_members', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const chatTitle = ctx.chat.title || 'بدون نام';
    
    for (const newMember of ctx.message.new_chat_members) {
      const userId = newMember.id;
      
      // بررسی آیا کاربر ربات است
      if (newMember.is_bot) continue;
      
      // ثبت اطلاعات کاربر در دیتابیس
      const { error: userError } = await supabase
        .from('users')
        .upsert({
          chat_id: userId,
          first_name: newMember.first_name,
          username: newMember.username,
          last_name: newMember.last_name,
          updated_at: new Date().toISOString()
        });

      if (userError) {
        console.error('Error saving user info:', userError);
      }

      // 🔥 قرنطینه خودکار کاربر جدید
      try {
        // بررسی وجود رکورد قبلی
        const { data: existingRecord, error: checkError } = await supabase
          .from('user_quarantine')
          .select('user_id')
          .eq('user_id', userId)
          .single();

        if (existingRecord) {
          // به‌روزرسانی رکورد موجود
          const { error: updateError } = await supabase
            .from('user_quarantine')
            .update({
              chat_id: chatId,
              is_quarantined: true,
              username: newMember.username,
              first_name: newMember.first_name,
              last_name: newMember.last_name,
              quarantine_start: new Date().toISOString(),
              quarantine_end: null
            })
            .eq('user_id', userId);

          if (updateError) {
            console.error('Error updating quarantine status:', updateError);
          }
        } else {
          // ایجاد رکورد جدید
          const { error: insertError } = await supabase
            .from('user_quarantine')
            .insert({
              user_id: userId,
              chat_id: chatId,
              is_quarantined: true,
              username: newMember.username,
              first_name: newMember.first_name,
              last_name: newMember.last_name,
              quarantine_start: new Date().toISOString(),
              quarantine_end: null
            });

          if (insertError) {
            console.error('Error inserting quarantine status:', insertError);
          }
        }

        // پاکسازی کش
        userCache.delete(`quarantine_${userId}`);
        
        // کیک کردن کاربر از تمام گروه‌های دیگر
        const kickedCount = await kickUserFromAllGroupsExceptCurrent(ctx, userId, chatId);
        
        console.log(`✅ کاربر ${userId} به طور خودکار قرنطینه شد و از ${kickedCount} گروه کیک شد`);
        
        // ارسال پیام اطلاع‌رسانی
        await ctx.replyWithHTML(
          `🔔 <b>سیستم قرنطینه خودکار</b>\n\n` +
          `👤 کاربر <b>${newMember.first_name || 'ناشناس'}</b> به طور خودکار قرنطینه شد!\n` +
          `📌 این کاربر از تمام گروه‌های دیگر حذف خواهد شد.`,
          { reply_to_message_id: ctx.message.message_id }
        );
        
      } catch (error) {
        console.error('Error in auto quarantine process:', error);
      }
    }
  } catch (error) {
    console.error('Error in new_chat_members handler:', error);
  }
});

// 🔥 هندلر تقویت شده برای بررسی کاربران قرنطینه
bot.on('chat_member', async (ctx) => {
  try {
    const newMember = ctx.update.chat_member.new_chat_member;
    const userId = newMember.user.id;
    const chatId = ctx.chat.id;
    
    if (newMember.status === 'member' || newMember.status === 'administrator') {
      const quarantine = await checkUserQuarantine(userId);
      
      if (quarantine && quarantine.chat_id !== chatId) {
        await kickUserFromGroup(ctx, chatId, userId, 'کاربر در قرنطینه است');
        await kickUserFromAllGroupsExceptCurrent(ctx, userId, quarantine.chat_id);
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

    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (existingUser) {
      await ctx.reply(`سلام ${firstName}! شما قبلاً در ربات ثبت شده���اید. 😊`);
    } else {
      const { error } = await supabase
        .from('users')
        .insert([{ chat_id: chatId, first_name: firstName, username: username }]);

      if (error) {
        console.error('Supabase insert error:', error);
        return ctx.reply('⚠️ مشکلی در ثبت اطلاعات پیش آمد. لطفاً بعداً تلاش کنید.');
      }

      await ctx.reply(`سلام ${firstName}! به ربات خوش آمدی. 😊`);
    }

    await ctx.replyWithHTML(`
🤖 <b>دستورات disponibles:</b>
/set_trigger - تنظیم تریگر جدید
#ورود - فعال کردن تریگر و قرنطینه کاربر
#خروج - غیرفعال کردن تریگر و خروج از قرنطینه
#فعال - ثبت گروه در سیستم (فقط ادمین)
/list_triggers - مشاهده لیست تریگرها
/delete_trigger - حذف تریگر
    `);

  } catch (err) {
    console.error('Error in /start command:', err);
    ctx.reply('❌ خطای غیرمنتظره‌ای رخ داد.');
  }
});

// دستور set_trigger - شروع فرآیند تنظیمات
bot.command('set_trigger', (ctx) => {
  ctx.scene.enter('set_trigger_wizard');
});

// 🔥 تشخیص #ورود در هر جای متن
bot.hears(/.*#ورود.*/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const firstName = ctx.from.first_name || 'کاربر';
    const username = ctx.from.username;

    const { data: settings, error: settingsError } = await supabase
      .from('trigger_settings')
      .select('*')
      .eq('chat_id', chatId)
      .single();

    if (settingsError || !settings) {
      return ctx.reply('❌ تنظیمات تریگر یافت نشد. لطفاً ابتدا از /set_trigger استفاده کنید.');
    }

    const { trigger_name, first_message, delay_seconds, second_message, first_message_entities, second_message_entities } = settings;

    // 🔥 ثبت یا به‌روزرسانی وضعیت قرنطینه کاربر
    try {
      const { data: existingRecord, error: checkError } = await supabase
        .from('user_quarantine')
        .select('user_id')
        .eq('user_id', userId)
        .single();

      if (existingRecord) {
        const { error: updateError } = await supabase
          .from('user_quarantine')
          .update({
            chat_id: chatId,
            is_quarantined: true,
            username: username,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            quarantine_start: new Date().toISOString(),
            quarantine_end: null
          })
          .eq('user_id', userId);

        if (updateError) {
          console.error('Error updating quarantine status:', updateError);
          return ctx.reply('❌ خطا در به روز رسانی قرنطینه کاربر.');
        }
      } else {
        const { error: insertError } = await supabase
          .from('user_quarantine')
          .insert({
            user_id: userId,
            chat_id: chatId,
            is_quarantined: true,
            username: username,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            quarantine_start: new Date().toISOString(),
            quarantine_end: null
          });

        if (insertError) {
          console.error('Error inserting quarantine status:', insertError);
          return ctx.reply('❌ خطا در ثبت قرنطینه کاربر.');
        }
      }

      userCache.delete(`quarantine_${userId}`);
      const kickedCount = await kickUserFromAllGroupsExceptCurrent(ctx, userId, chatId);
      
      console.log(`✅ کاربر ${userId} از ${kickedCount} گروه کیک شد و در گروه ${chatId} قرنطینه شد`);

    } catch (error) {
      console.error('Error in quarantine process:', error);
      return ctx.reply('❌ خطایی در فرآیند قرنطینه رخ داد.');
    }

    // ارسال پیام اول با حفظ entities
    let firstMessageText = first_message;
    if (first_message_entities && first_message_entities.length > 0) {
      await ctx.telegram.sendMessage(
        chatId,
        `🔔 <b>${trigger_name}</b> فعال شد!\n\n👤 کاربر: <b>${firstName}</b>\n⏰ تاخیر: ${delay_seconds} ثانیه\n\n${firstMessageText}`,
        {
          reply_to_message_id: ctx.message.message_id,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
          entities: first_message_entities
        }
      );
    } else {
      await ctx.replyWithHTML(`🔔 <b>${trigger_name}</b> فعال شد!\n\n👤 کاربر: <b>${firstName}</b>\n⏰ تاخیر: ${delay_seconds} ثانیه\n\n${firstMessageText}`, {
        reply_to_message_id: ctx.message.message_id,
        disable_web_page_preview: false
      });
    }

    // ارسال پیام دوم با تاخیر
    setTimeout(async () => {
      try {
        let secondMessageText = second_message;
        if (second_message_entities && second_message_entities.length > 0) {
          await ctx.telegram.sendMessage(
            chatId,
            `⏰ زمان تاخیر به پایان رسید!\n\n${secondMessageText}`,
            {
              reply_to_message_id: ctx.message.message_id,
              parse_mode: 'HTML',
              disable_web_page_preview: false,
              entities: second_message_entities
            }
          );
        } else {
          await ctx.telegram.sendMessage(
            chatId,
            `⏰ زمان تاخیر به پایان رسید!\n\n${secondMessageText}`,
            {
              reply_to_message_id: ctx.message.message_id,
              parse_mode: 'HTML',
              disable_web_page_preview: false
            }
          );
        }
      } catch (error) {
        console.error('Error sending delayed message:', error);
      }
    }, delay_seconds * 1000);

  } catch (error) {
    console.error('Error in #ورود command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// 🔥 تشخیص #خروج در هر جای متن
bot.hears(/.*#خروج.*/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    const { data: quarantine, error: checkError } = await supabase
      .from('user_quarantine')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!quarantine) {
      return ctx.reply('❌ شما در حال حاضر در قرنطینه نیستید.');
    }

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

    userCache.delete(`quarantine_${userId}`);
    
    await ctx.reply('✅ تریگر غیرفعال شد و شما از قرنطینه خارج شدید.');
  } catch (error) {
    console.error('Error in #خروج command:', error);
    ctx.reply('❌ خطایی در اجرای دستور رخ داد.');
  }
});

// دستور برای نمایش لیست تریگرها
bot.command('list_triggers', async (ctx) => {
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
      message += `${index + 1}. ${trigger.trigger_name}\n`;
      message += `   ⏰ تاخیر: ${trigger.delay_seconds} ثانیه\n`;
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
