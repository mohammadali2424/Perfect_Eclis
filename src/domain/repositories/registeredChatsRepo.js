const { supa } = require('../../infra/supabase');
const { cache } = require('../../utils/cache');

async function isAllowed(chatId){
  const k=`allowed:${chatId}`; const c=cache.get(k); if(c!==undefined) return c;
  try{ const {data,error}=await supa.from('registered_chats').select('chat_id').eq('chat_id',`${chatId}`).maybeSingle(); const ok=!error && !!data; cache.set(k,ok,600); return ok; }catch{ cache.set(k,false,120); return false; }
}
async function getState(chatId){
  const k=`rchat:${chatId}`; const c=cache.get(k); if(c) return c;
  const {data}=await supa.from('registered_chats').select('title,locked,locked_message,freeze_until').eq('chat_id',`${chatId}`).maybeSingle();
  const st={ title:data?.title||`${chatId}`, locked:!!data?.locked, lmsg:data?.locked_message||'این منطقه فعلاً بسته است.', freeze_until:data?.freeze_until?new Date(data.freeze_until).getTime():0 };
  cache.set(k,st,180); return st;
}
async function listAll(){
  const k='registered:list'; let regs=cache.get(k);
  if(!regs){ const {data}=await supa.from('registered_chats').select('chat_id,title').limit(5000); regs=data||[]; cache.set(k,regs,600); }
  return regs;
}
async function upsert(chatId,title){
  const {error}=await supa.from('registered_chats').upsert({chat_id:`${chatId}`,title,created_at:new Date().toISOString()},{onConflict:'chat_id'});
  if(!error) { cache.del(`allowed:${chatId}`); cache.del(`rchat:${chatId}`); }
  return error;
}
async function remove(chatId){ await supa.from('registered_chats').delete().eq('chat_id',`${chatId}`); cache.del(`allowed:${chatId}`); cache.del(`rchat:${chatId}`); }
async function setLocked(chatId,locked){ await supa.from('registered_chats').update({locked}).eq('chat_id',`${chatId}`); cache.del(`rchat:${chatId}`); }
async function setFreeze(chatId,until){ await supa.from('registered_chats').update({freeze_until: until}).eq('chat_id',`${chatId}`); cache.del(`rchat:${chatId}`); }

module.exports = { isAllowed, getState, listAll, upsert, remove, setLocked, setFreeze };
