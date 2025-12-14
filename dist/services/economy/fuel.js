"use strict";
// src/services/economy/fuel.ts
// منطق خالص (بدون تلگرام/DB) برای محاسبهٔ سوخت‌گیری
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeFuelPurchase = computeFuelPurchase;
/**
 * محاسبهٔ نتیجهٔ سوخت‌گیری.
 * - رفتار دقیقاً مثل کد فعلی: اگر full باشد، تا 100 پر می‌کند.
 * - اگر add <= 0 باشد: خطا "باک پر است".
 */
function computeFuelPurchase(params) {
    const fuelMax = Number.isFinite(params.fuelMax) ? params.fuelMax : 100;
    const fuelNow = clampNumber(params.fuelNow, 0, fuelMax);
    const add = params.amount === "full"
        ? Math.max(0, fuelMax - fuelNow)
        : Number(params.amount);
    if (!Number.isFinite(add) || add <= 0) {
        return { ok: false, errorText: "باک پر است." };
    }
    const fuelAfter = clampNumber(fuelNow + add, 0, fuelMax);
    const realAdd = fuelAfter - fuelNow; // اگر به سقف خورد
    const cost = realAdd * params.pricePerPercent;
    return {
        ok: true,
        addPercent: realAdd,
        fuelAfter,
        cost,
    };
}
function clampNumber(n, min, max) {
    const nn = Number(n);
    if (!Number.isFinite(nn))
        return min;
    return Math.min(max, Math.max(min, nn));
}
