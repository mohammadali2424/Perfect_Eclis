const { supa } = require('../../infra/supabase');
async function insertMovement(m){ await supa.from('movements').insert(m); }
async function dueForUser(userId){ const {data}=await supa.from('movements').select('move_id,arrive_at,state').eq('user_id',userId).eq('state','scheduled').lte('arrive_at', new Date().toISOString()).limit(50); return data||[]; }
async function hasActiveMove(userId){ const {data}=await supa.from('movements').select('move_id,departed_at').eq('user_id',userId).eq('state','scheduled').order('departed_at',{ascending:false}).limit(1); return data && data[0]; }
async function batchArrive(moveIds){ return await supa.from('movements').update({state:'arrived'}).in('move_id',moveIds).eq('state','scheduled').select('move_id,to_chat_id,to_page_id,user_id,gate_id'); }
async function cancelMove(moveId){ await supa.from('movements').update({state:'cancelled'}).eq('move_id',moveId); }
async function latestToChat(userId,chatId){ const {data}=await supa.from('movements').select('move_id,arrive_at,state,to_page_id,gate_id').eq('user_id',userId).eq('to_chat_id',chatId).eq('state','scheduled').order('departed_at',{ascending:false}).limit(1); return data&&data[0]; }
module.exports = { insertMovement, dueForUser, hasActiveMove, batchArrive, cancelMove, latestToChat };
