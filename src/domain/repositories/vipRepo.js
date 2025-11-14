// src/domain/repositories/vipRepo.js
const { supa } = require('../../infra/supabase');

async function setVip(userId) {
  await supa.from('vip_users').upsert({ user_id: userId, added_at: new Date().toISOString() }, { onConflict: 'user_id' });
}
async function unsetVip(userId) {
  await supa.from('vip_users').delete().eq('user_id', userId);
}

module.exports = { setVip, unsetVip };