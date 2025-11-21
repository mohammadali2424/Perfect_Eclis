const { Markup } = require('telegraf');
const { getGatesFromPage } = require('../../domain/repositories/gatesRepo');
const { getPages } = require('../../domain/repositories/pagesRepo');
const { neighbors, getPageById } = require('../../services/pageService');
const { buildMicroView } = require('../../services/microService');
const { putGateToken } = require('../../utils/tokens');

async function buildPageViewForUser(chatId, pageId){
  const page = await getPageById(pageId);
  if (!page) return null;

  // اگر میکرو-فلو تعریف شده، همون رو برگردون
  const microView = await buildMicroView(page, null);
  if (microView) return microView;

  const gates = await getGatesFromPage(pageId);
  const pages = await getPages(chatId);
  const neigh = neighbors(pages, pageId);

  const rows = [];
  for (const g of gates.slice(0, 24)) {
    const payload = {
      type: g.type || 'move',
      from_chat_id: `${chatId}`,
      from_page_id: `${pageId}`,
      to_chat_id: `${g.to_chat_id}`,
      to_page_id: `${g.to_page_id}`,
      gate_id: g.id,
      eta_sec: Math.max(0, Number(g.eta_sec || 0))
    };
    const token = putGateToken(payload);
    const label = g.label || 'حرکت';
    rows.push([Markup.button.callback(label, `g:${token.slice(2)}`)]);
  }

  const nav = [];
  if (neigh.prev) nav.push(Markup.button.callback('« قبلی', `pnav:${chatId}:${neigh.prev}`));
  if (neigh.next) nav.push(Markup.button.callback('بعدی »', `pnav:${chatId}:${neigh.next}`));
  if (nav.length) rows.push(nav);

  const text = `📜 ${page.title}\n\nمسیرهای شما:`;
  return { text, kb: Markup.inlineKeyboard(rows, { columns: 1 }), pageId: page.id };
}
module.exports = { buildPageViewForUser };
