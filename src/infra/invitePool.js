const invitePool = new Map();
async function getPooledJoinRequestLink(bot,toChatId){
  const now=Date.now(); const it=invitePool.get(toChatId);
  if(it && it.expireAtTs-now>45000) return it.link;
  const link = await bot.telegram.createChatInviteLink(toChatId,{
    expire_date: Math.floor((now+5*60_000)/1000),
    member_limit: 0, creates_join_request: true,
    name: `pool-${Math.floor(now/1000)}`
  });
  invitePool.set(toChatId,{link,expireAtTs:now+5*60_000});
  return link;
}
function sweep(){ const now=Date.now(); for(const [k,v] of invitePool.entries()){ if(v.expireAtTs<=now) invitePool.delete(k); } }
setInterval(sweep,60_000);
module.exports = { getPooledJoinRequestLink };
