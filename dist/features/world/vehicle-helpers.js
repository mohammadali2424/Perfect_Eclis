"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVehicleLoad = getVehicleLoad;
exports.hasBoardableVehicleHere = hasBoardableVehicleHere;
/**
 * لود کردن وضعیت یک وسیله:
 * - driverId: کسی که الان به عنوان راننده سوار است (مالک که riding_vehicle_id = vehicle.id دارد)
 * - passengerIds: بقیه‌ی افرادی که riding_vehicle_id = vehicle.id دارند
 */
async function getVehicleLoad(ctx, vehicleId) {
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
    let driverId = null;
    const passengerIds = [];
    for (const c of chars !== null && chars !== void 0 ? chars : []) {
        if (c.id === veh.owner_char_id)
            driverId = c.id;
        else
            passengerIds.push(c.id);
    }
    return { driverId, passengerIds };
}
/**
 * آیا در این Region/Spot وسیله‌ای هست که:
 *  - راننده سوارش باشد
 *  - ظرفیت خالی داشته باشد؟
 */
async function hasBoardableVehicleHere(ctx, regionId, spotId) {
    var _a;
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
    if (!vehicles || vehicles.length === 0)
        return false;
    for (const v of vehicles) {
        const { driverId, passengerIds } = await getVehicleLoad(ctx, v.id);
        if (!driverId)
            continue;
        const cap = (_a = v.capacity) !== null && _a !== void 0 ? _a : 1;
        const used = 1 + passengerIds.length;
        if (used < cap)
            return true;
    }
    return false;
}
