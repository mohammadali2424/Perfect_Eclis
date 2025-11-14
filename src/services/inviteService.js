// src/services/inviteService.js
// یک لایه‌ی خیلی باریک روی pool تا جاهای دیگه فقط اینو صدا بزنن.

const { getPooledJoinRequestLink } = require('../infra/invitePool');

// برمی‌گردونه: { invite_link, creator, expire_date, ... }
async function makeJoinLink(bot, toChatId) {
  // اگر join-request لازم ندارید، اینجا گزینه creates_join_request را تغییر دهید.
  return await getPooledJoinRequestLink(bot, toChatId);
}

module.exports = { makeJoinLink };
