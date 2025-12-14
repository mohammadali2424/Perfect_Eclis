"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMaster = isMaster;
exports.requirePrivate = requirePrivate;
exports.requireMaster = requireMaster;
// src/core/security.ts
const config_1 = require("./config");
function isMaster(ctx) {
    return !!ctx.from && ctx.from.id === config_1.MASTER_ID;
}
/**
 * گارد سبک: این handler را فقط در پیوی ادامه بده.
 * نکته: این یک util است؛ تا زمانی که خودت صداش نزنی رفتاری را تغییر نمی‌دهد.
 */
async function requirePrivate(ctx) {
    var _a;
    if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) === "private")
        return true;
    await ctx.reply("این بخش فقط در پیوی قابل استفاده است.");
    return false;
}
/**
 * گارد سبک: فقط مستر.
 */
async function requireMaster(ctx) {
    if (isMaster(ctx))
        return true;
    await ctx.reply("🥷🏻 فقط ارباب من می‌تونه این دستور رو استفاده کنه.");
    return false;
}
