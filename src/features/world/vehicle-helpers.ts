// =============================
// vehicle-helpers.ts
// Helper های مشترک برای سیستم وسایل نقلیه
// =============================

import { MyContext } from "../../core/types";

/**
 * لود کردن اطلاعات ظرفیت ماشین:
 * راننده + مسافران
 *
 * راننده = کسی که riding_vehicle_id او روی این vehicle تنظیم شده
 * مسافران = سطرهای جدول vehicle_passengers
 */
export async function getVehicleLoad(
  ctx: MyContext,
  vehicleId: number
): Promise<{ driverId: number | null; passengerIds: number[] }> {
  const { supabase } = ctx.services;

  // راننده
  const { data: drivers, error: dErr } = await supabase
    .from("characters")
    .select("id")
    .eq("riding_vehicle_id", vehicleId);

  if (dErr) {
    console.error("getVehicleLoad driver error:", dErr);
  }

  const driverId =
    drivers && drivers.length > 0 ? (drivers[0].id as number) : null;

  // مسافران
  const { data: passengers, error: pErr } = await supabase
    .from("vehicle_passengers")
    .select("character_id")
    .eq("vehicle_id", vehicleId);

  if (pErr) {
    console.error("getVehicleLoad passenger error:", pErr);
  }

  const passengerIds = (passengers ?? []).map(
    (p: any) => p.character_id as number
  );

  return { driverId, passengerIds };
}

/**
 * آیا در این region/spot وسیله‌ای هست که "قابل سوار شدن" باشد؟
 * یعنی راننده دارد و ظرفیت خالی دارد.
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
    if (!driverId) continue; // بدون راننده → اجازه‌ی سوار شدن نداریم

    const used = 1 + passengerIds.length; // ۱ راننده + مسافرها
    const free = (v.capacity ?? 1) - used;

    if (free > 0) return true;
  }

  return false;
}
