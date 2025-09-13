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
    await ctx.reply('📝 لطفاً پیام اول را وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.firstMessage = ctx.message.text;
    if (ctx.message.entities) {
      ctx.wizard.state.firstMessageEntities = ctx.message.entities;
    }
    await ctx.reply('📩 لطفاً پیام تاخیری را وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.secondMessage = ctx.message.text;
    if (ctx.message.entities) {
      ctx.wizard.state.secondMessageEntities = ctx.message.entities;
    }
    
    const { error } = await supabase
      .from('trigger_settings')
      .upsert({
        chat_id: ctx.chat.id,
        trigger_name: ctx.wizard.state.triggerName,
        first_message: ctx.wizard.state.firstMessage,
        first_message_entities: ctx.wizard.state.firstMessageEntities || [],
        delay_seconds: ctx.wizard.state.delaySeconds,
        second_message: ctx.wizard.state.secondMessage,
        second_message_entities: ctx.wizard.state.secondMessageEntities || []
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

    // فقط برای گروه‌ها و سوپرگروه‌ها
    if (chatType !== 'group' && chatType !== 'supergroup') {
      return ctx.reply('❌ این دستور فقط در گروه‌ها قابل استفاده است.');
    }

    // بررسی آیا کاربر ادمین است
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

    // ذخیره گروه در دیتابیس
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

    // فقط برای گروه‌ها و سوپرگروه‌ها
    if (chatType === 'group' || chatType === 'supergroup') {
      if (newStatus === 'administrator') {
        // ذخیره گروه با وضعیت ادمینی
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
        // ذخیره گروه با وضعیت عضو عادی
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
        // حذف گروه از دیتابیس
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

// 🔥 هندلر تقویت شده برای بررسی کاربران قرنطینه هنگام ورود به هر گروهی
bot.on('chat_member', async (ctx) => {
  try {
    const newMember = ctx.update.chat_member.new_chat_member;
    const userId = newMember.user.id;
    const chatId = ctx.chat.id;
    
    // فقط زمانی که کاربر به عنوان عضو جدید اضافه می‌شود
    if (newMember.status === 'member' || newMember.status === 'administrator') {
      // بررسی آیا کاربر در قرنطینه است
      const { data: quarantine, error: quarantineError } = await supabase
        .from('user_quarantine')
        .select('*')
        .eq('user_id', userId)
        .eq('is_quarantined', true)
        .single();

      if (quarantine && !quarantineError) {
        // بررسی آیا ربات در این گروه ادمین است و حق بن کردن دارد
        try {
          const chatMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
          const isBotAdmin = chatMember.status === 'administrator' && chatMember.can_restrict_members;
          
          if (isBotAdmin) {
            // بن فوری کاربر از گروه
            await ctx.telegram.banChatMember(chatId, userId, { 
              until_date: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7) // بن ۷ روزه
            });
            console.log(`🚫 کاربر ${userId} به طور خودکار از گروه ${chatId} بن شد (قرنطینه فعال)`);
            
            // حذف کاربر از گروه
            await ctx.telegram.kickChatMember(chatId, userId);
          } else {
            console.log(`⚠️ ربات در گروه ${chatId} ادمین نیست یا حق بن کردن ندارد`);
          }
        } catch (banError) {
          console.error(`❌ خطا در بن کردن کاربر ${userId} در گروه ${chatId}:`, banError);
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

    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('chat_id')
      .eq('chat_id', chatId)
      .single();

    if (existingUser) {
      await ctx.reply(`سلام ${firstName}! شما قبلاً در ربات ثبت شده‌اید. 😊`);
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

    // نمایش راهنمای دستورات
    await ctx.replyWithHTML(`
🤖 <b>دستورات disponibles:</b>
/set_trigger - تنظیم تریگر جدید
#ورود - فعال کردن تریگر
#خروج - غیرفعال کردن تریگر
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

// 🔥 تشخیص #ورود در هر جای متن (جایگزین /trigger1)
bot.hears(/.*#ورود.*/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const firstName = ctx.from.first_name || 'کاربر';

    // دریافت تنظیمات از Supabase
    const { data: settings, error: settingsError } = await supabase
      .from('trigger_settings')
      .select('*')
      .eq('chat_id', chatId)
      .single();

    if (settingsError || !settings) {
      return ctx.reply('❌ تنظیمات تریگر یافت نشد. لطفاً ابتدا از /set_trigger استفاده کنید.');
    }

    const { trigger_name, first_message, delay_seconds, second_message } = settings;

    // 🔥 بن کاربر در تمام گروه‌های موجود و آینده
    try {
      // دریافت همه گروه‌هایی که ربات در آنها ادمین است
      const { data: groups, error: groupsError } = await supabase
        .from('groups')
        .select('chat_id, title')
        .eq('is_bot_admin', true);

      if (!groupsError && groups && groups.length > 0) {
        for (const group of groups) {
          if (group.chat_id !== chatId) {
            try {
              await ctx.telegram.banChatMember(group.chat_id, userId, { 
                until_date: Math.floor(Date.now() / 1000) + (delay_seconds * 2)
              });
              console.log(`✅ کاربر ${userId} از گروه ${group.title} بن شد`);
            } catch (banError) {
              console.error(`❌ خطا در بن کردن کاربر در گروه ${group.chat_id}:`, banError);
            }
          }
        }
      }

      // ذخیره وضعیت قرنطینه کاربر
      const { error: quarantineError } = await supabase
        .from('user_quarantine')
        .upsert({
          user_id: userId,
          chat_id: chatId,
          is_quarantined: true,
          quarantine_start: new Date().toISOString()
        });

      if (quarantineError) {
        console.error('Error saving quarantine status:', quarantineError);
      }
    } catch (banError) {
      console.error('Error in ban process:', banError);
    }

    // ارسال پیام اول
    await ctx.replyWithHTML(`🔔 <b>${trigger_name}</b> فعال شد!\n\n👤 کاربر: <b>${firstName}</b>\n⏰ تاخیر: ${delay_seconds} ثانیه\n\n${first_message}`, {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    });

    // ارسال پیام دوم با تاخیر
    setTimeout(async () => {
      try {
        await ctx.telegram.sendMessage(
          chatId, 
          `⏰ زمان تاخیر به پایان رسید!\n\n${second_message}`,
          {
            reply_to_message_id: ctx.message.message_id,
            parse_mode: 'HTML',
            disable_web_page_preview: false
          }
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

// 🔥 تشخیص #خروج در هر جای متن (جایگزین /trigger2)
bot.hears(/.*#خروج.*/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    // آنبن کاربر از تمام گروه‌های ذخیره شده
    try {
      const { data: groups, error: groupsError } = await supabase
        .from('groups')
        .select('chat_id, title')
        .eq('is_bot_admin', true);

      if (!groupsError && groups && groups.length > 0) {
        for (const group of groups) {
          if (group.chat_id !== chatId) {
            try {
              await ctx.telegram.unbanChatMember(group.chat_id, userId);
              console.log(`✅ کاربر ${userId} از گروه ${group.title} آنبن شد`);
            } catch (unbanError) {
              console.error(`❌ خطا در آنبن کردن کاربر در گروه ${group.chat_id}:`, unbanError);
            }
          }
        }
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
      }
    } catch (unbanError) {
      console.error('Error in unban process:', unbanError);
    }

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
    
    // دریافت تمام تریگرهای گروه
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

    // حذف تریگر
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
