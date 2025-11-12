const { getPooledJoinRequestLink } = require('../infra/invitePool');
async function makeJoinLink(bot,toChatId){ return await getPooledJoinRequestLink(bot,toChatId); }
module.exports = { makeJoinLink };
