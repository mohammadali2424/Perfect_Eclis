// src/features/commands/mk.js
const { supa } = require('../../infra/supabase');
const { parseDur } = require('../../utils/text');
const { safeSend } = require('../../infra/queue');

function ensurePV(ctx) { return ctx.chat?.type === 'private'; }

async function getPageById(id) {
  const { data, error } = await supa
    .from('pages')
    .select('id,chat_id,title')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function insertGate(row) {
  const { error } = await supa.from('gates').insert(row);
  if (error) throw error;
}

function helpText() {
  return [
    'ساخت مسیر سریع:',
    '`/mk <type> <from_page> <to_page> [time] [emoji]`',
    '',
    'type: m|s|mi  (m=main, s=sub, mi=micro)',
    'time: 30s | 1m | 2m | 5m | 10m (اختیاری، پیش‌فرض 60s)',
    'emoji: مثل 🌿 (اختیاری)',
    '',
    'نمونه‌ها:',
    '`/mk m 12 88 2m 🌿`',
    '`/mk s 5 6 30s`',
    '`/mk mi 7 7`',
  ].join('\n');
}

async function handleMk(ctx) {
  if (!ensurePV(ctx)) {
    // در گروه: پیام را حذف و راهنما را در PV بده
    try { await ctx.deleteMessage(); } catch (_) {}
    try { await safeSend(ctx.telegram, ctx.from.id, helpText(), { parse_mode: 'Markdown' }); } catch(_) {}
    return;
  }

  const text = String(ctx.message?.text || '');
  const m = text.match(/^\/mk(?:@[\w_]+)?\s+(\w+)\s+(\d+)\s+(\d+)(?:\s+([0-9hmsHMS]+))?(?:\s+(.+))?$/);
  if (!m) {
    return ctx.reply(helpText(), { parse_mode: 'Markdown' });
  }

  let [, typRaw, fromIdStr, toIdStr, timeRaw, emojiRaw] = m;
  const typeMap = { m: 'main', s: 'sub', mi: 'micro' };
  const tkey = (typRaw || '').toLowerCase();
  const type = typeMap[tkey] || null;
  if (!type) return ctx.reply('type نامعتبر است. یکی از m|s|mi');

  const fromId = parseInt(fromIdStr, 10);
  const toId = parseInt(toIdStr, 10);
  if (!fromId || !toId) return ctx.reply('شناسهٔ صفحه‌ها نامعتبر است.');

  const base_sec = timeRaw ? (parseDur(timeRaw) || 60) : 60;
  let emoji = (emojiRaw || '').trim();
  if (!emoji) emoji = type === 'main' ? '➡️' : (type === 'sub' ? '↪️' : '🪶');

  // خواندن صفحات
  const fromPage = await getPageById(fromId);
  const toPage = await getPageById(toId);
  if (!fromPage || !toPage) return ctx.reply('صفحهٔ مبدا یا مقصد یافت نشد.');

  const fromChat = `${fromPage.chat_id}`;
  const toChat   = `${toPage.chat_id}`;

  if ((type === 'sub' || type === 'micro') && fromChat !== toChat) {
    return ctx.reply('برای sub/micro باید مبدا و مقصد در یک گروه باشند.');
  }

  const row = {
    type,
    from_chat_id: fromChat,
    from_page_id: fromPage.id,
    to_chat_id: type === 'main' ? toChat : fromChat,
    to_page_id: toPage.id,
    label: `${emoji} ${toPage.title}`.slice(0, 64),
    emoji,
    base_travel_sec: base_sec,
    created_at: new Date().toISOString(),
  };

  try {
    await insertGate(row);
  } catch (e) {
    return ctx.reply('❌ ساخت مسیر شکست خورد.');
  }

  await ctx.reply(
    `✅ مسیر ساخته شد:\nنوع: ${type}\nاز: [${fromPage.id}] ${fromPage.title}\nبه: [${toPage.id}] ${toPage.title}\nمدت: ${timeRaw || (base_sec >= 60 ? (base_sec/60)+'m' : base_sec+'s')}\nایموجی: ${emoji}`
  );
}

function register(bot) {
  bot.command('mk', handleMk);
}

module.exports = { register };
