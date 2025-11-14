// src/features/helpers/pageUi.js
const { Markup } = require('telegraf');
const { getGatesFromPage } = require('../../domain/repositories/gatesRepo');
const { getPages, getPageById } = require('../../domain/repositories/pagesRepo');
const { neighbors } = require('../../services/pageService');
const { buildMicroView } = require('../../services/microService');
const { putGateToken } = require('../../utils/tokens');
const { humanize } = require('../../utils/text');

async function buildPageViewForUser(chatId, pageId) {
  const page = await getPageById(pageId); if (!page) return null;
  const microView = await buildMicroView(page, null); if (microView) return microView;

  const gates = await getGatesFromPage(pageId);
  const pages = await getPages(chatId);
  const neigh = neighbors(pages, pageId);

  const rows = [];
  for (const g of gates.slice(0, 24)) {
    const label = `${g.emoji || ''} ${g.label || ''}`.trim() + (g.base_travel_sec ? ` • ${humanize(g.base_travel_sec)}` : '');
    const token = putGateToken({ gate_id: g.id, type: g.type, eta: g.base_travel_sec || 0 });
    rows.push([Markup.button.callback(label, `g:${token.slice(2)}`)]);
  }

  const nav = [];
  if (neigh.prev) nav.push(Markup.button.callback('◀️ قبلی', `pnav:${chatId}:${neigh.prev}`)); else nav.push(Markup.button.callback('▫️', 'pnav:nop'));
  nav.push(Markup.button.callback('⏳ زمانِ باقی‌ماندهٔ من', 'pmenu:eta'));
  if (neigh.next) nav.push(Markup.button.callback('بعدی ▶️', `pnav:${chatId}:${neigh.next}`)); else nav.push(Markup.button.callback('▫️', 'pnav:nop'));
  if (nav.length) rows.push(nav);

  const text = `📜 ${page.title}\n\nمسیر های شما :`;
  return { text, kb: Markup.inlineKeyboard(rows, { columns: 1 }), pageId: page.id };
}
module.exports = { buildPageViewForUser };