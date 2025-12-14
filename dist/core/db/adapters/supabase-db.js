"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeSupabaseDb = makeSupabaseDb;
function makeSupabaseDb(supabase) {
    return {
        async getCharacterByTgId(tgId) {
            const { data, error } = await supabase
                .from("characters")
                .select("*")
                .eq("tg_id", tgId)
                .maybeSingle();
            if (error)
                return { ok: false, error };
            return { ok: true, data };
        },
        async updateCharacterById(id, patch) {
            const { error } = await supabase.from("characters").update(patch).eq("id", id);
            if (error)
                return { ok: false, error };
            return { ok: true, data: null };
        },
        async getVehicleById(id) {
            const { data, error } = await supabase
                .from("vehicles")
                .select("*")
                .eq("id", id)
                .maybeSingle();
            if (error)
                return { ok: false, error };
            return { ok: true, data };
        },
        async updateVehicleById(id, patch) {
            const { error } = await supabase.from("vehicles").update(patch).eq("id", id);
            if (error)
                return { ok: false, error };
            return { ok: true, data: null };
        },
        // ✅ جدول flux_wells شما region_id ندارد → فقط spot_id + enabled را چک می‌کنیم
        async hasFluxWell(spotId) {
            const { data, error } = await supabase
                .from("flux_wells")
                .select("spot_id, enabled, kind")
                .eq("spot_id", spotId)
                .eq("enabled", true)
                // اگر چند نوع چاه داری، این خط رو نگه دار:
                .eq("kind", "fuel")
                .maybeSingle();
            if (error)
                return { ok: false, error };
            return { ok: true, data: !!data };
        },
        async createFluxWell(regionId, spotId) {
            // regionId در اسکیمای شما وجود ندارد، پس ذخیره‌اش نمی‌کنیم
            const { error } = await supabase.from("flux_wells").insert({
                spot_id: spotId,
                enabled: true,
                kind: "fuel",
            });
            if (error)
                return { ok: false, error };
            return { ok: true, data: null };
        },
    };
}
