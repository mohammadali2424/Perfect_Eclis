// src/services/economy/fuel.ts
// منطق خالص (بدون تلگرام/DB) برای محاسبهٔ سوخت‌گیری

export type FuelPurchaseAmount = number | "full";

export type FuelPurchaseResult =
  | {
      ok: true;
      addPercent: number;
      fuelAfter: number;
      cost: number;
    }
  | {
      ok: false;
      errorText: string;
    };

/**
 * محاسبهٔ نتیجهٔ سوخت‌گیری.
 * - رفتار دقیقاً مثل کد فعلی: اگر full باشد، تا 100 پر می‌کند.
 * - اگر add <= 0 باشد: خطا "باک پر است".
 */
export function computeFuelPurchase(params: {
  fuelNow: number;
  amount: FuelPurchaseAmount;
  pricePerPercent: number;
  fuelMax?: number;
}): FuelPurchaseResult {
  const fuelMax = Number.isFinite(params.fuelMax) ? (params.fuelMax as number) : 100;
  const fuelNow = clampNumber(params.fuelNow, 0, fuelMax);

  const add =
    params.amount === "full"
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

function clampNumber(n: number, min: number, max: number) {
  const nn = Number(n);
  if (!Number.isFinite(nn)) return min;
  return Math.min(max, Math.max(min, nn));
}
