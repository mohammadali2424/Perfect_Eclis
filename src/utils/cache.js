const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 180, checkperiod: 120, maxKeys: 20000 });
const inFlightUser = new NodeCache({ stdTTL: 8, checkperiod: 15 });
const cbMap = new NodeCache({ stdTTL: 600, checkperiod: 120, maxKeys: 50000 });

module.exports = { cache, inFlightUser, cbMap };
