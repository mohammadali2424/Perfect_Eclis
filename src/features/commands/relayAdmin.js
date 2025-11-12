const { supa } = require('../../infra/supabase');
const { parseDur } = require('../../utils/text');

function onlyOwner(config,ctx){
  if(ctx.from?.id===config.ownerId) return true;
  try{ ctx.reply('به غیر از ارباب کسی نمیتونه به ما دستور بده',{ reply_to_message_id: ctx.message?.message_id }); }catch{}
  return false;
}

async function setRelay(pageId, status, durationSec, note){
  const { data } = await supa.from('pages').select('meta_json').eq('id',pageId).maybeSingle();
  const meta = data?.meta_json || {};
  const until = durationSec ? new Date(Date.now()+durationSec*1000).toISOString() : null;
  meta.relay = { status, note: note||null, until };
  await supa.from('pages').update({ meta_json: meta }).eq('id',pageId);
}

async function clearRelay(pageId){
  const { data } = await supa.from('pages').select('meta_json').eq('id',pageId).maybeSingle();
  const meta = data?.meta_json || {};
  delete meta.relay;
  await supa.from('pages').update({ meta_json: meta }).eq('id',pageId);
}

async function showRelay(pageId){
  const { data } = await supa.from('pages').select('meta_json').eq('id',pageId).maybeSingle();
  return data?.meta_json?.relay || null;
}

function register(bot,config){
  // /relay_set <pageId> <green|yellow|red> [duration] [note...]
  bot.command('relay_set', async (ctx)=>{
    if(!onlyOwner(config,ctx)) return;
    const parts=(ctx.message.text||'').split(/\s+/);
    const pageId=parseInt(parts[1],10);
    const status=(parts[2]||'').toLowerCase();
    if(!pageId || !['green','yellow','red'].includes(status)) return ctx.reply('فرمت: /relay_set <pageId> <green|yellow|red> [duration] [note]');
    let durSec=null, note=null;
    if(parts[3]){ const p=require('../../utils/text').parseDur(parts[3]); if(p) durSec=p; }
    if(parts.length>4){ note=parts.slice(4).join(' '); }
    try{ await setRelay(pageId,status,durSec,note); ctx.reply('✅ چراغ صفحه اعمال شد'); }catch{ ctx.reply('❌ خطا در ذخیره'); }
  });

  bot.command('relay_clear', async (ctx)=>{
    if(!onlyOwner(config,ctx)) return;
    const parts=(ctx.message.text||'').split(/\s+/);
    const pageId=parseInt(parts[1],10);
    if(!pageId) return ctx.reply('فرمت: /relay_clear <pageId>');
    try{ await clearRelay(pageId); ctx.reply('✅ چراغ صفحه پاک شد'); }catch{ ctx.reply('❌ خطا در حذف'); }
  });

  bot.command('relay_show', async (ctx)=>{
    if(!onlyOwner(config,ctx)) return;
    const parts=(ctx.message.text||'').split(/\s+/);
    const pageId=parseInt(parts[1],10);
    if(!pageId) return ctx.reply('فرمت: /relay_show <pageId>');
    const r = await showRelay(pageId);
    if(!r) return ctx.reply('چراغی برای این صفحه تنظیم نشده.');
    ctx.reply(`وضعیت: ${r.status}\nیادداشت: ${r.note||'-'}\nتا: ${r.until||'-'}`);
  });
}

module.exports = { register };
