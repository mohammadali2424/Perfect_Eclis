// src/domain/repositories/movementsRepo.js
const { supa } = require('../../infra/supabase');

async function insertMovement(m) {
  await supa.from('movements').insert(m);
}

async function dueForUser(userId) {
  const { data } = await supa
    .from('movements')
    .select('move_id,user_id,to_chat_id,to_page_id,arrive_at,gate_id')
    .eq('user_id', userId)
    .eq('state', 'scheduled')
    .lte('arrive_at', new Date().toISOString())
    .order('arrive_at', { ascending: true })
    .limit(50);
  return data || [];
}

async function hasActiveMove(userId) {
  const { data } = await supa
    .from('movements')
    .select('move_id,arrive_at,departed_at')
    .eq('user_id', userId)
    .eq('state', 'scheduled')
    .order('departed_at', { ascending: false })
    .limit(1);
  return data && data[0];
}

async function batchArrive(moveIds) {
  if (!moveIds || !moveIds.length) return { data: [] };
  const { data } = await supa
    .from('movements')
    .update({ state: 'arrived' })
    .in('move_id', moveIds)
    .eq('state', 'scheduled')
    .select('move_id,to_chat_id,to_page_id,user_id,gate_id');
  return { data };
}

async function cancelMove(moveId) {
  await supa.from('movements').update({ state: 'cancelled' }).eq('move_id', moveId);
}

async function latestToChat(userId, chatId) {
  const { data } = await supa
    .from('movements')
    .select('move_id,arrive_at')
    .eq('user_id', userId)
    .eq('to_chat_id', `${chatId}`)
    .order('departed_at', { ascending: false })
    .limit(1);
  return data && data[0];
}

module.exports = { insertMovement, dueForUser, hasActiveMove, batchArrive, cancelMove, latestToChat };