// src/domain/repositories/gatesRepo.js
const { supa } = require('../../infra/supabase');
const { cache } = require('../../utils/cache');

async function getGatesFromPage(pageId) {
  const k = `gates:from:${pageId}`;
  const c = cache.get(k);
  if (c) return c;
  const { data } = await supa
    .from('gates')
    .select('id,type,from_chat_id,from_page_id,to_chat_id,to_page_id,label,emoji,base_travel_sec,order_index,active')
    .eq('from_page_id', pageId)
    .order('order_index', { ascending: true })
    .order('id', { ascending: true })
    .limit(2000);
  const rows = (data || []).filter(g => g.active !== false);
  cache.set(k, rows, 180);
  return rows;
}

async function insertGate(g) {
  const { error } = await supa.from('gates').insert(g);
  if (!error) {
    cache.del(`gates:from:${g.from_page_id}`);
    if (g.type === 'main') cache.del(`gates:from:${g.to_page_id}`);
  }
  return error;
}

async function updateGate(id, fields) {
  await supa.from('gates').update(fields).eq('id', id);
}

module.exports = { getGatesFromPage, insertGate, updateGate };