// src/utils/tokens.js
const { cbMap } = require('./cache');
function randToken(n = 10) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let s = '';
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
const putGateToken    = (p) => { const t = `g:${randToken(12)}`; cbMap.set(t, p); return t; };
const getGateToken    = (t) => cbMap.get(t) || null;
const putCancelToken  = (p) => { const t = `c:${randToken(12)}`; cbMap.set(t, p); return t; };
const getCancelToken  = (t) => cbMap.get(t) || null;
const putMicroToken   = (p) => { const t = `m:${randToken(12)}`; cbMap.set(t, p); return t; };
const getMicroToken   = (t) => cbMap.get(t) || null;
module.exports = { putGateToken, getGateToken, putCancelToken, getCancelToken, putMicroToken, getMicroToken };