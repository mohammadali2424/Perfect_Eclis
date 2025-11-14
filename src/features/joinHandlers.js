// src/features/joinHandlers.js
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
        try{ await bot.telegram.sendMessage(userId, `⏳ هنوز ${left} ثانیه تا رسیدن باقی مانده`); }catch{}
      }
    }catch{}
  });

  bot.on('my_chat_member', async (ctx)=>{
    try{
      const ns=ctx.update.my_chat_member?.new_chat_member?.status;
      const adder=ctx.update.my_chat_member?.from?.id;
      const chatId=ctx.chat?.id;
      if(ns&&['member','administrator'].includes(ns)){
        if(adder!==config.ownerId){
          try{ await bot.telegram.sendMessage(chatId,'این ربات مخصوص جهانِ شماست؛ اجازهٔ استفاده ندارید.'); }catch{}
          try{ await bot.telegram.leaveChat(chatId); }catch{}
        }
      }
    }catch{}
  });
}
module.exports = { register };