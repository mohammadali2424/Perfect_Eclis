const { getPages, getPageById } = require('../domain/repositories/pagesRepo');
function neighbors(pages,pageId){ const idx=pages.findIndex(p=>p.id===pageId); if(idx<0) return {prev:null,next:null,index:-1,total:pages.length}; return { prev: pages[idx-1]?.id||null, next: pages[idx+1]?.id||null, index: idx, total: pages.length }; }
async function firstPage(chatId){ const pages=await getPages(chatId); return pages[0]||null; }
module.exports = { neighbors, firstPage, getPageById };
