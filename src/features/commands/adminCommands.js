// src/features/commands/adminCommands.js
const { upsert, remove, setLocked, setFreeze } = require('../../services/moderationService');
const { parseDur } = require('../../utils/text');

function onlyOwner(config,ctx){
  if(ctx.from?.id===config.ownerId) return true;
  try{ ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده',{ reply_to_message_id: ctx.message?.message_id }); }catch{}
  return false;
}

function register(bot,config){
  bot.command('on', async (ctx)=>{
    if(!onlyOwner(config,ctx)) return;
    const id = `${ctx.chat.id}`;
    const title = ctx.chat?.title || id;
    const err = await upsert(id,title);
    if(err) return ctx.reply('❌ خطا در ثبت منطقه');
    ctx.reply('✅ منطقه ثبت شد');
  });
  bot.command('off', async (ctx)=>{
    if(!onlyOwner(config,ctx)) return;
    const id = `${ctx.chat.id}`;
    await remove(id);
    try{ await ctx.leaveChat(); }catch{}
  });
  bot.command('lock', async (ctx)=>{
    if(!onlyOwner(config,ctx)) return;
    const id = `${ctx.chat.id}`;
    await setLocked(id,true);
    ctx.reply('⛔️ این منطقه قفل شد');
  });
  bot.command('unlock', async (ctx)=>{
    if(!onlyOwner(config,ctx)) return;
    const id = `${ctx.chat.id}`;
    await setLocked(id,false);
    ctx.reply('✅ این منطقه باز شد');
  });
  bot.command('freeze', async (ctx)=>{
    if(!onlyOwner(config,ctx)) return;
    const id = `${ctx.chat.id}`;
    const txt = (ctx.message?.text||'').split(/\s+/)[1]||'10m';
    const sec = parseDur(txt);
    if(!sec) return ctx.reply('زمان نامعتبر');
    const until = new Date(Date.now()+sec*1000).toISOString();
    await setFreeze(id,until);
    ctx.reply('❄️ فریز اعمال شد');
  });
  bot.command('unfreeze', async (ctx)=>{
    if(!onlyOwner(config,ctx)) return;
    const id = `${ctx.chat.id}`;
    await setFreeze(id,null);
    ctx.reply('🔥 فریز برداشته شد');
  });
}
module.exports = { register };