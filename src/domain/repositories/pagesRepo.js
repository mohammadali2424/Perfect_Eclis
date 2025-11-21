const { supa } = require('../../infra/supabase');
const { cache } = require('../../utils/cache');

async function getPages(chatId){
  const k=`pages:${chatId}`; const c=cache.get(k); if(c) return c;
  const {data,error}=await supa.from('pages').select('id,chat_id,title,body,order_index,active,meta_json').eq('chat_id',`${chatId}`).order('order_index',{ascending:true}).order('title',{ascending:true}).limit(2000);
  if(error){ cache.set(k,[],60); return []; }
  const rows=(data||[]).filter(p=>p.active!==false);
  cache.set(k,rows,180); return rows;
}
async function getPageById(id){
  const k=`page:${id}`; const c=cache.get(k); if(c) return c;
  const {data}=await supa.from('pages').select('id,chat_id,title,body,order_index,active,meta_json').eq('id',id).maybeSingle();
  if(data) cache.set(k,data,180);
  return data||null;
}
async function insertPage(chatId,title,body){
  const pages=await getPages(chatId);
  const order=(pages[pages.length-1]?.order_index||0)+1;
  const ins={chat_id:`${chatId}`,title,body,order_index:order,active:true};
  const {data, error}=await supa.from('pages').insert(ins).select('id').single();
  if(!error) cache.del(`pages:${chatId}`);
  return {id:data?.id||null, error};
}

module.exports = { getPages, getPageById, insertPage };
