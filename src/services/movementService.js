const { insertMovement: repoInsert, hasActiveMove: repoHasActive, batchArrive } = require('../domain/repositories/movementsRepo');
const { upsertPlayer } = require('../domain/repositories/playersRepo');

async function hasActiveMove(userId){
  return await repoHasActive(userId);
}

async function insertMovement(m){
  // m: { move_id, user_id, from_chat_id, from_page_id, to_chat_id, to_page_id, gate_id, eta_sec }
  const now = new Date();
  const eta = Math.max(0, Number(m.eta_sec || 0));
  const departed_at = now.toISOString();
  const arrive_at = new Date(now.getTime() + eta * 1000).toISOString();

  const rec = {
    move_id: m.move_id || `${Date.now()}_${m.user_id}`,
    user_id: m.user_id,
    from_chat_id: `${m.from_chat_id}`,
    from_page_id: m.from_page_id || null,
    to_chat_id: `${m.to_chat_id}`,
    to_page_id: m.to_page_id || null,
    gate_id: m.gate_id || null,
    state: 'scheduled',
    departed_at,
    arrive_at
  };
  await repoInsert(rec);
  return rec;
}

// وقتی کاربر واقعاً رسید (تأیید join یا فرارسیدن زمان)
async function queueArrival({ move_id }){
  const { data: arrived } = await batchArrive([move_id]);
  const r = Array.isArray(arrived) && arrived[0];
  if (r) {
    await upsertPlayer({
      user_id: r.user_id,
      current_chat_id: `${r.to_chat_id}`,
      current_page_id: r.to_page_id || null,
      updated_at: new Date().toISOString()
    });
  }
}

module.exports = { hasActiveMove, insertMovement, queueArrival };
