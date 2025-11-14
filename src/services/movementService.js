// src/services/movementService.js
const { insertMovement: _insert, dueForUser, hasActiveMove: _hasActive, batchArrive } = require('../domain/repositories/movementsRepo');
const { supa } = require('../infra/supabase');
const { getPageById } = require('./pageService');
const { mention } = require('../utils/text');
const { safeSend } = require('../infra/queue');

let timers = new Map();
let arrQ = [];
let arrTimer = null;

function nowIso(){ return new Date().toISOString(); }
function queueArrival(evt) { arrQ.push(evt); if (!arrTimer) arrTimer = setTimeout(flush, 400); }

async function flush() {
  const batch = arrQ.splice(0, arrQ.length);
  arrTimer = null;
  if (batch.length === 0) return;
  const ids = batch.map(b => b.move_id);
  const { data: updated } = await batchArrive(ids);
  if (!updated || !updated.length) return;

  // update players to destination
  const rows = updated.map(u => ({
    user_id: u.user_id,
    current_chat_id: `${u.to_chat_id}`,
    current_page_id: u.to_page_id,
    status: 'idle',
    updated_at: nowIso()
  }));
  await supa.from('players').upsert(rows, { onConflict: 'user_id' });

  // notify arrivals in dest chats, if member
  const labelsMap = {};
  const gids = updated.map(u => u.gate_id).filter(Boolean);
  if (gids.length) {
    const { data: grows } = await supa.from('gates').select('id,label').in('id', gids);
    for (const g of (grows || [])) labelsMap[g.id] = g.label;
  }
  for (const u of updated) {
    let isMember = false;
    try {
      const cm = await global.bot.telegram.getChatMember(u.to_chat_id, u.user_id);
      isMember = !!cm && ['member','administrator','creator'].includes(cm.status);
    } catch {}
    if (!isMember) continue;

    const page = await getPageById(u.to_page_id);
    const routeName = u.gate_id ? (labelsMap[u.gate_id] || null) : (page?.title || 'اینجا');
    await safeSend(global.bot, u.to_chat_id, `🎯 پلیر ${mention(u.user_id)} وارد ${routeName || page?.title || 'اینجا'} شد`, { parse_mode: 'Markdown' });
  }
}

async function scheduleSub(move) {
  const d = Math.max(0, new Date(move.arrive_at).getTime() - Date.now());
  if (d > 60*60*1000) return; // don't schedule very far
  if (timers.has(move.move_id)) return;
  const id = setTimeout(()=>{ timers.delete(move.move_id); queueArrival({ move_id: move.move_id }); }, d);
  timers.set(move.move_id, id);
}

async function insertMovement(m) {
  await _insert(m);
  scheduleSub(m);
}

async function hasActiveMove(userId) { return await _hasActive(userId); }

module.exports = { insertMovement, dueForUser, hasActiveMove, queueArrival };