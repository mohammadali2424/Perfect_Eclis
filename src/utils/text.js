// src/utils/text.js
// ابزارهای متنی: نرمال‌سازی فارسی، تبدیل زمان، پارس مدت و ...
function humanize(sec) {
  let s = Math.max(1, Math.round(sec));
  if (s < 60) return `${s} ثانیه`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (!r) return `${m} دقیقه`;
  return `${m} دقیقه و ${r} ثانیه`;
}
function normalize(s = '') {
  return String(s)
    .replace(/\u200c/g, '')
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[ـ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function isTrigger(text, word) {
  const norm = normalize(text).toLowerCase();
  const re = new RegExp(`^#\s*${word}(?:\s|$)`);
  return re.test(norm);
}
function parseDur(txt = '') {
  const m = String(txt).trim().match(/^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs)?$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const u = (m[2] || 'm').toLowerCase();
  if (['s','sec','secs'].includes(u)) return n;
  if (['h','hr','hrs'].includes(u)) return n * 3600;
  return n * 60;
}
const mention = (uid) => `[${uid}](tg://user?id=${uid})`;
module.exports = { humanize, normalize, isTrigger, parseDur, mention };