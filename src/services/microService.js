const { putMicroToken } = require('../utils/tokens');
const { Markup } = require('telegraf');
const { getPageById } = require('./pageService');

async function buildMicroView(pageOrId,currentNodeKey){
  const page = typeof pageOrId==='object' ? pageOrId : await getPageById(pageOrId);
  const meta = page?.meta_json; const micro=meta?.micro; if(!micro) return null;
  const nodeKey=currentNodeKey||micro.start; const node=micro.nodes?.[nodeKey]; if(!node) return null;
  const rows=[]; for(const btn of (node.buttons||[]).slice(0,24)){ const tok=putMicroToken({page_id: page.id, next_key: btn.goto, eta: btn.eta||0, label: btn.label}); rows.push([Markup.button.callback(btn.label,`m:${tok.slice(2)}`)]); }
  return { text:`📜 ${node.title}`, kb: Markup.inlineKeyboard(rows,{columns:1}), nodeKey };
}

module.exports = { buildMicroView };
