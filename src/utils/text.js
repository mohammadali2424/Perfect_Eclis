const humanize=(s)=>{ s=Math.max(1,Math.round(s)); if(s<60) return `${s} ثانیه`; const m=Math.floor(s/60),r=s%60; return r?`${m} دقیقه و ${r} ثانیه`:`${m} دقیقه`; };
const normalize=(s='')=>s.replace(/\u200c/g,'').replace(/[ي]/g,'ی').replace(/[ك]/g,'ک').replace(/[ـ]+/g,'').replace(/\s+/g,' ').trim();
const isTrigger=(t,word)=>new RegExp(`^#\\s*${word}(?:\\s|$)`).test(normalize(t).toLowerCase());
const parseDur=(txt='')=>{ const m=String(txt).trim().match(/^(\d+)\s*(s|sec|m|min|h|hr)?$/i); if(!m) return null; const n=parseInt(m[1],10); const u=(m[2]||'m').toLowerCase(); if(u==='s'||u==='sec') return n; if(u==='h'||u==='hr') return n*3600; return n*60; };
const mention=(uid)=>`[${uid}](tg://user?id=${uid})`;

module.exports = { humanize, normalize, isTrigger, parseDur, mention };
