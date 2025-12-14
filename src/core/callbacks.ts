// src/core/callbacks.ts
// یک نقطه‌ی مرکزی برای ساخت/پارس callback_data ها
// (فعلاً فقط چند مورد که زیاد استفاده می‌شوند.)

export const CB = {
  vehDash: "veh:dash",
  fluxFuelMenu: "flux:fuel",
  fuelFull: "fuel:full",
  fuelCustom: "fuel:custom",
  fuelAdd: (percent: number) => `fuel:add:${percent}`,
  isFuelAdd: (data: string) => /^fuel:add:(\d+)$/.exec(data),
} as const;
