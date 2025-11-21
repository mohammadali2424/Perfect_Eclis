const { supa } = require('../../infra/supabase');
function onlyOwner(config,ctx){ if(ctx.from?.id===config.ownerId) return true; try{ ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده',{ reply_to_message_id: ctx.message?.message_id }); }catch{} return false; }
function register(bot,config){
  bot.command('micro_set', async (ctx)=>{
    if(ctx.chat?.type!=='private'||!onlyOwner(config,ctx)) return;
    const reply=ctx.message?.reply_to_message?.text;
    if(!reply) return ctx.reply('JSON را ریپلای این دستور کن\n/micro_set <page_id>');
    let obj; try{ obj=JSON.parse(reply);}catch{ return ctx.reply('JSON نامعتبر'); }
    if(!obj.micro||!obj.micro.nodes||!obj.micro.start) return ctx.reply('ساختار micro ناقص است');
    const pageId=(ctx.message?.text||'').split(/\s+/)[1]; if(!pageId) return ctx.reply('فرمت: /micro_set <page_id>');
    const { error }=await supa.from('pages').update({meta_json:obj}).eq('id',pageId);
    if(error) return ctx.reply('خطای ذخیره: '+(error.message||''));
    ctx.reply('✅ micro ذخیره شد');
  });
  bot.command('micro_clear', async (ctx)=>{
    if(ctx.chat?.type!=='private'||!onlyOwner(config,ctx)) return;
    const pageId=(ctx.message?.text||'').split(/\s+/)[1]; if(!pageId) return ctx.reply('فرمت: /micro_clear <page_id>');
    const { error }=await supa.from('pages').update({meta_json:null}).eq('id',pageId);
    if(error) return ctx.reply('خطای حذف: '+(error.message||''));
    ctx.reply('✅ micro پاک شد');
  });
}
module.exports = { register };
