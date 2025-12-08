// =============================
// vehicle-helpers.ts
// Helper های مشترک برای سیستم وسایل نقلیه
// =============================

import { MyContext } from "../../core/bot";

/**
 * لود کردن اطلاعات ظرفیت ماشین:
 * راننده + مسافران
 */
export async function getVehicleLoad(
  ctx: MyContext,
  vehicleId: number
): Promise<{ driverId: number | null; passengerIds: number[] }> {
  const { supabase } = ctx.services;

  const { data: loadRows, error } = await supabase
    .from("vehicle_passengers")
    .select("character_id, is_driver")
    .eq("vehicle_id", vehicleId);

  if (error || !loadRows) {
    return { driverId: null, passengerIds: [] };
  }

  const driverRow = loadRows.find((x) => x.is_driver);
  const driverId = driverRow?.character_id ?? null;

  const passengerIds = loadRows
    .filter((x) => !x.is_driver)
    .map((x) => x.character_id);

  return { driverId, passengerIds };
}

/**
 * آیا در این region/spot وسیله‌ای هست که "قابل سوار شدن" باشد؟
 * یعنی driver دارد و ظرفیت خالی دارد.
 */
export async function hasBoardableVehicleHere(
  ctx: MyContext,
  regionId: number,
  spotId: number
): Promise<boolean> {
  const { supabase } = ctx.services;

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, capacity, current_region_id, current_spot_id")
    .eq("current_region_id", regionId)
    .eq("current_spot_id", spotId);

  if (error || !vehicles || vehicles.length === 0) {
    return false;
  }

  for (const v of vehicles) {
    const { driverId, passengerIds } = await getVehicleLoad(ctx, v.id);
    if (!driverId) continue; // بدون راننده → سوار شدن مجاز نیست

    const used = 1 + passengerIds.length;
    const free = (v.capacity ?? 1) - used;

    if (free > 0) return true;
  }

  return false;
}
