// src/utils/auth.js
const OWNER_ID = process.env.OWNER_ID ? String(process.env.OWNER_ID) : null;

function isOwner(ctx) {
  const uid = ctx?.from?.id ? String(ctx.from.id) : '';
  return Boolean(OWNER_ID && uid === OWNER_ID);
}

async function requireOwner(ctx, next) {
  if (isOwner(ctx)) return next();
  const msg = 'من فقط از اربابم دستور می‌گیرم';
  if (ctx.chat?.type === 'private') {
    try { await ctx.reply(msg); } catch {}
  } else {
    try { await ctx.deleteMessage(); } catch {}
    try { await ctx.telegram.sendMessage(ctx.from.id, msg); } catch {}
  }
}

module.exports = { OWNER_ID, isOwner, requireOwner };
