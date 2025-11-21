const { cache } = require('../utils/cache');
async function isBotAdmin(bot,chatId,meId){
  const k=`admin:${chatId}`; const c=cache.get(k); if(c!==undefined) return c;
  try{ const me=await bot.telegram.getChatMember(chatId,meId); const ok=['administrator','creator'].includes(me.status); cache.set(k,ok,600); return ok; }catch{ cache.set(k,false,120); return false; }
}
async function softKick(bot,chatId,userId,meId){
  try{
    if(!await isBotAdmin(bot,chatId,meId)) return false;
    try{ const m=await bot.telegram.getChatMember(chatId,userId); if(['left','kicked','creator'].includes(m.status)) return true; }catch{}
    await bot.telegram.banChatMember(chatId,userId);
    setTimeout(()=>bot.telegram.unbanChatMember(chatId,userId).catch(()=>{}),10_000);
    return true;
  }catch{ return false; }
}
async function kickOthers(bot,keepChatId,userId,meId,registered){
  for(const r of registered){ const cid=`${r.chat_id}`; if(cid===`${keepChatId}`) continue; await softKick(bot,cid,userId,meId); }
}
module.exports = { isBotAdmin, softKick, kickOthers };
