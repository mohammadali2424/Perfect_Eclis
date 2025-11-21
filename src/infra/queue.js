const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const q = [];
let pumping = false;

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    q.push({ fn, resolve, reject });
    if (!pumping) pump();
  });
}

async function pump() {
  pumping = true;
  while (q.length) {
    const job = q.shift();
    try {
      const res = await job.fn();
      job.resolve(res);
    } catch (e) {
      job.reject(e);
    }
    await sleep(80);
  }
  pumping = false;
}

async function safeSend(bot, chatId, text, extra = {}, retries = 2) {
  try {
    return await enqueue(() => bot.telegram.sendMessage(chatId, text, extra));
  } catch (e) {
    const msg = String(e && e.message || e);
    if (retries > 0 && /429|ETELEGRAM|timeout/i.test(msg)) {
      const m = /retry after\s*(\d+)/i.exec(msg);
      const wait = m ? (parseInt(m[1], 10) * 1000) : 1500;
      try { await sleep(wait); } catch {}
      return await enqueue(() => bot.telegram.sendMessage(chatId, text, extra));
    }
    throw e;
  }
}

module.exports = { safeSend, enqueue };
