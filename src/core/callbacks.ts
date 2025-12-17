// src/core/callbacks.ts
// A central place for callback_data helpers.
// - Legacy strings remain for backward compatibility
// - New structured cbq:v1:* are signed and routed via CallbackRouter

import { encodeCbq } from "./cbq";

export const CB = {
  // ===== Legacy callbacks =====
  vehDash: "veh:dash",
  fluxFuelMenu: "flux:fuel",
  fuelFull: "fuel:full",
  fuelCustom: "fuel:custom",
  fuelAdd: (percent: number) => `fuel:add:${percent}`,
  isFuelAdd: (data: string) => /^fuel:add:(\d+)$/.exec(data),

  // ===== New signed callbacks =====
  cbq: (module: string, action: string, payload: string = "") => encodeCbq(module, action, payload),
} as const;
