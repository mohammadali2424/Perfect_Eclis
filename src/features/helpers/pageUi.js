const { Markup } = require('telegraf');
const { getGatesFromPage } = require('../../domain/repositories/gatesRepo');
const { getPages } = require('../../domain/repositories/pagesRepo');
const { neighbors, getPageById } = require('../../services/pageService');
const { buildMicroView } = require('../../services/microService');
const { putGateToken } = require('../../utils/tokens');
const { humanize } = require('../../utils/text');

function relayBadge(meta){
  const r = meta?.relay; if(!r) return '';
  const untilOk = !r.until || new Date(r.until).getTime() > Date.now();
  const st = (untilOk && r.status) ? r.status : null;
  if(!st) return '';
  const em = st==='green'?'🟢':st==='yellow'?'🟡':st==='red'?'🔴':'⚪️';
  const note = r.note ? ` — ${r.note}` : '';
  return `${em} چراغ وضعیت: ${st}${note}\n\n`;
}

async function buildPageViewForUser(chatId,pageId){
  const page = await getPageById(pageId); if(!page) return null;

  // اگر micro تعریف شده، همان را نشان بده
  const microView = await buildMicroView(page, null);
  if(microView) return microView;

  const gates=await getGatesFromPage(pageId);
  const pages=await getPages(chatId);
  const neigh=neighbors(pages,pageId);

  const rows=[];
  for(const g of gates.slice(0,24)){
    const label=`${g.emoji||'🧭'} ${g.label} — ${humanize(g.base_travel_sec)}`;
    const token=require('../../utils/tokens').putGateToken({gate_id:g.id,type:g.type,eta:g.base_travel_sec});
    rows.push([Markup.button.callback(label,`g:${token.slice(2)}`)]);
  }
  const nav=[]; if(neigh.prev) nav.push(Markup.button.callback('◀️',`pnav:${chatId}:${neigh.prev}`));
  nav.push(Markup.button.callback(`${neigh.index+1}/${neigh.total}`,'pnav:nop'));
  if(neigh.next) nav.push(Markup.button.callback('▶️',`pnav:${chatId}:${neigh.next}`));
  rows.push(nav);
  rows.push([Markup.button.callback('⏳ زمانِ باقی‌ماندهٔ من','pmenu:eta')]);

  const relay = relayBadge(page.meta_json||null);
  const text=`${relay}📜 ${page.title}\n\nمسیر های شما :`;
  return { text, kb: Markup.inlineKeyboard(rows,{columns:1}), pageId: page.id };
}

module.exports = { buildPageViewForUser };
