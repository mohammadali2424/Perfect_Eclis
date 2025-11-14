// src/features/triggers.js
const { Markup } = require('telegraf');
const { supa } = require('../infra/supabase');
const { humanize } = require('../utils/text');
const { putGateToken } = require('../utils/tokens'); // باید در پروژه‌ات باشد

async function getFirstPage(chatId) {
  const { data } = await supa
    .from('pages')
    .select('id,title,order_index')
    .eq('chat_id', `${chatId}`)
    .order('order_index', { ascending: true })
    .limit(1);
  return data?.[0] || null;
}
async function getGatesFromPage(pageId) {
  const { data } = await supa
    .from('gates')
    .select('id,type,label,emoji,base_travel_sec,to_page_id,to_chat_id')
    .eq('from_page_id', pageId)
    .eq('active', true)
    .order('id', { ascending: true });
  return data || [];
}

function gateRowButtons(uid, gates) {
  const rows = [];
  for (const g of gates) {
    const tok = putGateToken({ gate_id: g.id, user_id: uid }); // تولید توکن اینلاین
    // gateActions با الگوی /^g:(...)/ کار می‌کند → باید فقط suffix را بفرستیم
    const suffix = String(tok).replace(/^g:/,'');
    const title = `${g.emoji || ''} ${g.label || ''}`.trim() || (g.type==='micro'?'🪶 مسیر':'مسیر');
    const timeS = (g.type==='micro' ? '' : ` • ${humanize(g.base_travel_sec||60)}`);
    rows.push([ Markup.button.callback(`${title}${timeS}`, `g:${suffix}`) ]);
  }
  return Markup.inlineKeyboard(rows, { columns: 1 });
}

async function sendMenuPV(tg, uid, chatId) {
  const first = await getFirstPage(chatId);
  if (!first) {
    await tg.sendMessage(uid, 'برای این گروه هنوز صفحه‌ای ساخته نشده.');
    return;
  }
  const gates = await getGatesFromPage(first.id);
  const head = `📜 ${first.title}\nمسیرهای شما:`;
  const kb = gateRowButtons(uid, gates);
  await tg.sendMessage(uid, head, { reply_markup: kb.reply_markup });
}

function register(bot) {
  // #ورود
  bot.hears(/^#ورود$/i, async (ctx) => {
    const chat = ctx.chat;
    if (!chat || !(chat.type==='group'||chat.type==='supergroup')) return;

    // پیام کاربر را پاک کن
    try { await ctx.deleteMessage(); } catch {}

    // بازیکن را به این گروه ست کن (اگر صفحه اول هست)
    const first = await getFirstPage(chat.id);
    await supa.from('players').upsert({
      user_id: ctx.from.id,
      current_chat_id: `${chat.id}`,
      current_page_id: first?.id || null,
      status: 'idle',
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    // منو را در PV بفرست
    try {
      await sendMenuPV(ctx.telegram, ctx.from.id, chat.id);
    } catch (e) {
      // PV بسته است: دیپ‌لینک بده و پیام را خودپاک‌کن
      const botUser = global.BOT_UNAME ? `https://t.me/${global.BOT_UNAME}?start=go` : 'پی‌وی ربات را استارت کن.';
      const m = await ctx.reply(`برای ادامه، لطفاً پی‌وی را باز کن:\n${botUser}`);
      setTimeout(async()=>{ try{ await ctx.deleteMessage(m.message_id); }catch{} }, 8000);
      return;
    }

    // پیام کوتاه تایید در گروه (خودپاک‌کن)
    const m2 = await ctx.reply('منوی شما در پی‌وی ارسال شد.');
    setTimeout(async()=>{ try{ await ctx.deleteMessage(m2.message_id); }catch{} }, 5000);
  });

  // #خروج
  bot.hears(/^#خروج$/i, async (ctx) => {
    const chat = ctx.chat;
    if (!chat || !(chat.type==='group'||chat.type==='supergroup')) return;
    try { await ctx.deleteMessage(); } catch {}

    await supa.from('players').update({
      status: 'idle',
      current_chat_id: null,
      current_page_id: null,
      updated_at: new Date().toISOString()
    }).eq('user_id', ctx.from.id);

    try { await ctx.telegram.sendMessage(ctx.from.id, 'خارج شدی. هر زمان خواستی دوباره #ورود بزن.'); } catch {}
    const m = await ctx.reply('خارج شدی (PV را ببین).');
    setTimeout(async()=>{ try{ await ctx.deleteMessage(m.message_id); }catch{} }, 5000);
  });
}

module.exports = { register };
