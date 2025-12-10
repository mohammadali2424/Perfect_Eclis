import { MyContext } from "../../core/types";

/**
 * لود کردن وضعیت یک وسیله:
 * - driverId: کسی که الان به عنوان راننده سوار است (مالک که riding_vehicle_id = vehicle.id دارد)
 * - passengerIds: بقیه‌ی افرادی که riding_vehicle_id = vehicle.id دارند
 */
export async function getVehicleLoad(
  ctx: MyContext,
  vehicleId: number
): Promise<{ driverId: number | null; passengerIds: number[] }> {
  const { supabase } = ctx.services;

  const { data: veh, error: vehErr } = await supabase
    .from("vehicles")
    .select("id, owner_char_id, capacity")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vehErr || !veh) {
    console.error("getVehicleLoad vehicle error:", vehErr);
    return { driverId: null, passengerIds: [] };
  }

  const { data: chars, error: charsErr } = await supabase
    .from("characters")
    .select("id")
    .eq("riding_vehicle_id", vehicleId);

  if (charsErr) {
    console.error("getVehicleLoad chars error:", charsErr);
    return { driverId: null, passengerIds: [] };
  }

  let driverId: number | null = null;
  const passengerIds: number[] = [];

  for (const c of chars ?? []) {
    if (c.id === (veh as any).owner_char_id) driverId = c.id;
    else passengerIds.push(c.id);
  }

  return { driverId, passengerIds };
}

/**
 * آیا در این Region/Spot وسیله‌ای هست که:
 *  - راننده سوارش باشد
 *  - ظرفیت خالی داشته باشد؟
 */
export async function hasBoardableVehicleHere(
  ctx: MyContext,
  regionId: number,
  spotId: number
): Promise<boolean> {
  const { supabase } = ctx.services;

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, owner_char_id, capacity")
    .eq("current_region_id", regionId)
    .eq("current_spot_id", spotId);

  if (error) {
    console.error("hasBoardableVehicleHere vehicles error:", error);
    return false;
  }

  if (!vehicles || vehicles.length === 0) return false;

  for (const v of vehicles) {
    const { driverId, passengerIds } = await getVehicleLoad(ctx, v.id);
    if (!driverId) continue;

    const cap = (v as any).capacity ?? 1;
    const used = 1 + passengerIds.length;
    if (used < cap) return true;
  }

  return false;
}
