const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const q=[]; let pumping=false;
const enqueue=fn=>new Promise((res)=>{ q.push({fn,res}); if(!pumping) pump(); });
async function pump(){ pumping=true; while(q.length){ const {fn,res}=q.shift(); try{ res(await fn()); }catch(e){ res(Promise.reject(e)); } await sleep(80);} pumping=false; }
async function safeSend(bot,chatId,text,extra={}){
  try { return await enqueue(()=>bot.telegram.sendMessage(chatId,text,extra)); }
  catch(e){ const m=String(e.message||e); if(/429|timeout|ETELEGRAM/i.test(m)){ await sleep(600); try{ return await enqueue(()=>bot.telegram.sendMessage(chatId,text,extra)); }catch{} } throw e; }
}
module.exports = { safeSend };
