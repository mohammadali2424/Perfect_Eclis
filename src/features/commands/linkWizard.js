// src/features/commands/linkWizard.js
const { Markup } = require('telegraf');
const { canDMUser, ephemeralNotice, safeDelete } = require('../helpers/telegram');
const { parseDur, normalize } = require('../../utils/text');
const { supa } = require('../../infra/supabase');

let ME_USERNAME = null;
async function deepLink(bot) {
  try {
    const me = await bot.telegram.getMe();
    ME_USERNAME = me.username || ME_USERNAME;
  } catch (_) {}
  return ME_USERNAME ? `https://t.me/${ME_USERNAME}?start=hi` : null;
}

function pvIntroKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ ساخت صفحه جدید', 'lw:new_page')],
    [Markup.button.callback('➕ ساخت مسیر جدید', 'lw:new_gate')],
  ]);
}

async function ensurePV(bot, ctx) {
  const userId = ctx.from.id;
  const dmOk = await canDMUser(bot, userId);
  if (dmOk) {
    try {
      await bot.telegram.sendMessage(
        userId,
        'جادوگر لینک 🤖 آماده‌ست. می‌تونی صفحه یا مسیر بسازی:',
        pvIntroKb()
      );
    } catch (_) {}
    return true;
  }
  const url = await deepLink(bot);
  await ephemeralNotice(
    ctx,
    ctx.chat.id,
    url
      ? `برای ادامهٔ ویزارد، یک بار به پی‌وی من پیام بده:\n${url}`
      : 'برای ادامهٔ ویزارد، یک بار به پی‌وی من پیام بده.',
    5000
  );
  return false;
}

function register(bot) {
  // 1) فراخوانی /link_wizard هرجا
  bot.command('link_wizard', async (ctx) => {
    const chatType = ctx.chat?.type;
    const inGroup = chatType === 'group' || chatType === 'supergroup';

    if (inGroup) {
      // پاک‌کردن پیام کاربر (نیاز به دسترسی delete_messages)
      if (ctx.message?.message_id) {
        await safeDelete(ctx, ctx.chat.id, ctx.message.message_id);
      }
      // انتقال بی‌سروصدا به PV
      await ensurePV(bot, ctx);
      return;
    }

    // PV
    await ctx.reply('جادوگر لینک 🤖 — چه کاری انجام بدهم؟', pvIntroKb());
  });

  // 2) حذف هر /lw_* در گروه + انتقال به PV
  bot.hears(/^\/lw_(page|gate)\b/i, async (ctx) => {
    const chatType = ctx.chat?.type;
    if (chatType === 'group' || chatType === 'supergroup') {
      if (ctx.message?.message_id)
        await safeDelete(ctx, ctx.chat.id, ctx.message.message_id);
      await ensurePV(bot, ctx);
      return;
    }
    return ctx.reply(
      'دستور مستقیم ویزارد شناسایی شد اما بهتره از منوی بالا استفاده کنی 👆'
    );
  });

  // 3) اکشن‌های سادهٔ ویزارد در PV
  bot.action('lw:new_page', async (ctx) => {
    if (ctx.chat?.type !== 'private') return ctx.answerCbQuery().catch(() => {});
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply(
      'ساخت صفحهٔ جدید:\nمثال:\n`/lw_page عنوان صفحه`\n\nبعدش مسیر می‌سازی.',
      { parse_mode: 'Markdown' }
    );
  });

  bot.action('lw:new_gate', async (ctx) => {
    if (ctx.chat?.type !== 'private') return ctx.answerCbQuery().catch(() => {});
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply(
      'ساخت مسیر جدید:\nمثال:\n`/lw_gate type=main from_page=1 to_chat=-100... to_page=2 label=درهٔ سبز emoji=🌿 time=5m`\n\nپارامترهای ضروری: type, from_page, (to_chat و to_page برای main) یا فقط to_page برای sub/micro',
      { parse_mode: 'Markdown' }
    );
  });

  // 4) دستورات متن‌محور ساده در PV
  bot.hears(/^\/lw_page\s+(.+)/i, async (ctx) => {
    if (ctx.chat?.type !== 'private') return; // فقط PV
    const title = normalize(ctx.match[1] || '').slice(0, 100);
    if (!title) return ctx.reply('عنوان نامعتبر است.');
    // باید گروه هدف را هم داشته باشیم: آخرین گروهی که پلیر در آن است
    const uid = ctx.from.id;
    const { data: p } = await supa
      .from('players')
      .select('current_chat_id')
      .eq('user_id', uid)
      .maybeSingle();

    if (!p?.current_chat_id) {
      return ctx.reply(
        'ابتدا در یک گروه #ورود بزن تا منطقهٔ فعلی‌ات معلوم شود.'
      );
    }

    const { data: page, error } = await supa
      .from('pages')
      .insert({
        chat_id: `${p.current_chat_id}`,
        title,
        order_index: 0,
        meta_json: {},
        created_at: new Date().toISOString(),
      })
      .select('id,title')
      .single();

    if (error) return ctx.reply('نتوانستم صفحه بسازم. بعداً دوباره تلاش کن.');
    await ctx.reply(`✅ صفحه ساخته شد: [${page.id}] ${page.title}`);
  });

  bot.hears(/^\/lw_gate\s+(.+)/i, async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    const raw = ctx.match[1];

    // پارس پارامترها: key=value
    const kv = {};
    for (const m of raw.matchAll(/(\w+)=("[^"]+"|'[^']+'|[^\s]+)/g)) {
      const k = m[1].toLowerCase();
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      kv[k] = v;
    }

    const type = (kv.type || 'main').toLowerCase(); // main | sub | micro
    const from_page = parseInt(kv.from_page, 10);
    const to_page = kv.to_page ? parseInt(kv.to_page, 10) : null;
    const to_chat = kv.to_chat ? String(kv.to_chat) : null;
    const label = kv.label ? String(kv.label).slice(0, 64) : '';
    const emoji = kv.emoji ? String(kv.emoji).slice(0, 8) : '';
    const t = kv.time ? parseDur(kv.time) : null;

    if (!from_page || ['main', 'sub', 'micro'].indexOf(type) < 0) {
      return ctx.reply('پارامترها نامعتبرند. حداقل type و from_page را بده.');
    }
    if (type === 'main' && (!to_chat || !to_page)) {
      return ctx.reply('برای مسیر main باید to_chat و to_page مشخص باشند.');
    }
    if ((type === 'sub' || type === 'micro') && !to_page) {
      return ctx.reply('برای مسیر sub/micro باید to_page مشخص باشد.');
    }

    const base_travel_sec = t && t > 0 ? t : 60;

    const insert = {
      type,
      from_chat_id: null, // از روی from_page در DB پر می‌کنیم
      from_page_id: from_page,
      to_chat_id: type === 'main' ? to_chat : null,
      to_page_id: to_page,
      label,
      emoji,
      base_travel_sec,
      created_at: new Date().toISOString(),
    };

    // از DB، chat_id صفحهٔ مبدا را می‌خوانیم
    const { data: f } = await supa
      .from('pages')
      .select('id,chat_id')
      .eq('id', from_page)
      .maybeSingle();
    if (!f) return ctx.reply('from_page پیدا نشد.');
    insert.from_chat_id = `${f.chat_id}`;

    const { error } = await supa.from('gates').insert(insert);
    if (error) return ctx.reply('نتوانستم مسیر بسازم.');
    await ctx.reply('✅ مسیر ساخته شد.');
  });
}

module.exports = { register };
