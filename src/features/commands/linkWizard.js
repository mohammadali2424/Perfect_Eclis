const { Markup } = require('telegraf');
const { supa } = require('../../infra/supabase');
const { getPages, insertPage } = require('../../domain/repositories/pagesRepo');

const wiz = new Map();

function state(uid) { return wiz.get(`w:${uid}`) || null; }
function setState(uid, patch) { const s = { ...(state(uid) || {}), ...patch }; wiz.set(`w:${uid}`, s); return s; }
function clearState(uid) { wiz.delete(`w:${uid}`); }

function ensureOwner(ctx, ownerId){
  return `${ctx.from?.id}` === `${ownerId}`;
}

function register(bot, config){
  const OWNER_ID = config.ownerId;

  bot.command('linkwizard', async (ctx)=>{
    if (!ensureOwner(ctx, OWNER_ID)) return ctx.reply('فقط مالک.');
    setState(ctx.from.id, { step: 'ask_chat' });
    return ctx.reply('شناسهٔ گروه مقصد را بفرست (chat_id). ارسال /cancel برای خروج.');
  });

  bot.command('cancel', async (ctx)=>{
    clearState(ctx.from.id);
    return ctx.reply('لغو شد.');
  });

  bot.on('text', async (ctx)=>{
    const s = state(ctx.from.id);
    if (!s) return;

    if (s.step === 'ask_chat'){
      const chatId = (ctx.message.text || '').trim();
      setState(ctx.from.id, { step: 'ask_title', chatId });
      return ctx.reply('عنوان صفحه؟');
    }

    if (s.step === 'ask_title'){
      const title = (ctx.message.text || '').trim();
      const { id } = await insertPage(s.chatId, title, '');
      clearState(ctx.from.id);
      return ctx.reply(`صفحه ساخته شد (ID: ${id}). از پنل دیتابیس، Gate ها را اضافه کن.`);
    }
  });
}

module.exports = { register };
