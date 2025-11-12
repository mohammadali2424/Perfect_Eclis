const { supa } = require('../../infra/supabase');
async function upsertPlayer(p){ await supa.from('players').upsert(p,{onConflict:'user_id'}); }
async function getPlayer(userId){ const {data}=await supa.from('players').select('user_id,current_chat_id,current_page_id,status,updated_at,pending_credit_sec').eq('user_id',userId).maybeSingle(); return data||null; }
module.exports = { upsertPlayer, getPlayer };
