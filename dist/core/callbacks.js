"use strict";
// src/core/callbacks.ts
// یک نقطه‌ی مرکزی برای ساخت/پارس callback_data ها
// (فعلاً فقط چند مورد که زیاد استفاده می‌شوند.)
Object.defineProperty(exports, "__esModule", { value: true });
exports.CB = void 0;
exports.CB = {
    vehDash: "veh:dash",
    fluxFuelMenu: "flux:fuel",
    fuelFull: "fuel:full",
    fuelCustom: "fuel:custom",
    fuelAdd: (percent) => `fuel:add:${percent}`,
    isFuelAdd: (data) => /^fuel:add:(\d+)$/.exec(data),
};
