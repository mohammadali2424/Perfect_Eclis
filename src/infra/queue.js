// src/infra/queue.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const queue = [];
let pumping = false;
function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    if (!pumping) pump();
  });
}
async function pump() {
  pumping = true;
  while (queue.length) {
    const { fn, resolve, reject } = queue.shift();
    try {
      const res = await fn();
      resolve(res);
    } catch (err) {
      reject(err);
    }
    await sleep(80);
  }
  pumping = false;
}
async function safeSend(bot, chatId, text, extra = {}) {
  try {
    return await enqueue(() => bot.telegram.sendMessage(chatId, text, extra));
  } catch (e) {
    const m = String(e.message || e);
    if ( /bot was blocked by the user|user is deactivated|chat not found|have no rights to send a message/i.test(m) ) {
      return null;
    }
    const retryMatch = m.match(/retry after (\d+)/i);
    if (retryMatch) {
      const delaySec = parseInt(retryMatch[1], 10);
      await sleep((delaySec + 1) * 1000);
      try { return await bot.telegram.sendMessage(chatId, text, extra); } catch {}
    }
    throw e;
  }
}
module.exports = { safeSend };