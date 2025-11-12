const { isAllowed, getState, listAll, upsert, remove, setLocked, setFreeze } = require('../domain/repositories/registeredChatsRepo');
const { setVip, unsetVip } = require('../domain/repositories/vipRepo');
module.exports = { isAllowed, getState, listAll, upsert, setVip, unsetVip, setLocked, setFreeze, remove };
