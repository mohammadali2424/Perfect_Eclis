const { latestToChat } = require('../domain/repositories/movementsRepo');
const { queueArrival } = require('../services/movementService');

function register(bot,config){
  bot.on('chat_join_request', async (ctx)=>{
    try{
      const req=ctx.update.chat_join_request; const userId=req.from.id; const chatId=`${req.chat.id}`;
      const mv=await latestToChat(userId,chatId); if(!mv) return ctx.declineChatJoinRequest(userId);
      const now=new Date();
      if(new Date(mv.arrive_at)<=now){
        try{ await bot.telegram.unbanChatMember(chatId,userId);}catch{}
        await ctx.approveChatJoinRequest(userId);
        queueArrival({move_id: mv.move_id});
      } else {
        await ctx.declineChatJoinRequest(userId);
        const left=Math.max(1,Math.round((new Date(mv.arrive_at).getTime()-now.getTime())/1000));
        try{ await bot.telegram.sendMessage(userId,`⏳ هنوز زود است؛ ${left} ثانیه دیگر تلاش کن.`);}catch{}
      }
    }catch{}
  });

  bot.on('new_chat_members', async (ctx)=>{
    try{
      const chatId=`${ctx.chat.id}`; const members=ctx.message?.new_chat_members||[];
      for(const m of members){ const uid=m.id; const mv=await latestToChat(uid,chatId); if(!mv) continue; if(new Date(mv.arrive_at)<=new Date()) queueArrival({move_id: mv.move_id}); }
    }catch{}
  });

  bot.on('my_chat_member', async (ctx)=>{
    try{
      const ns=ctx.update.my_chat_member?.new_chat_member?.status;
      const adder=ctx.update.my_chat_member?.from?.id;
      const chatId=ctx.chat?.id;
      if(ns&&['member','administrator'].includes(ns)){
        if(adder!==config.ownerId){
          try{ await bot.telegram.sendMessage(chatId,'این ربات متعلق به مجموعه اکلیس است ، شما حق استفاده از آنها رو ندارین ، حدتو بدون'); }catch{}
          try{ await bot.telegram.leaveChat(chatId); }catch{}
        }
      }
    }catch{}
  });
}
module.exports = { register };
