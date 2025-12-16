import { GameDb, DbResult } from "../repo";
import { DbCharacter, DbVehicle } from "../types";

export function makeSupabaseDb(supabase: any): GameDb {
  return {
    async getCharacterByTgId(tgId: number): Promise<DbResult<DbCharacter | null>> {
      const { data, error } = await supabase
        .from("characters")
        .select("*")
        .eq("tg_id", tgId)
        .maybeSingle();

      if (error) return { ok: false, error };
      return { ok: true, data };
    },

    async updateCharacterById(id: number, patch: Partial<DbCharacter>): Promise<DbResult<null>> {
      const { error } = await supabase.from("characters").update(patch).eq("id", id);
      if (error) return { ok: false, error };
      return { ok: true, data: null };
    },

    async getVehicleById(id: number): Promise<DbResult<DbVehicle | null>> {
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) return { ok: false, error };
      return { ok: true, data };
    },

    async updateVehicleById(id: number, patch: Partial<DbVehicle>): Promise<DbResult<null>> {
      const { error } = await supabase.from("vehicles").update(patch).eq("id", id);
      if (error) return { ok: false, error };
      return { ok: true, data: null };
    },

    // ✅ جدول flux_wells شما region_id ندارد → فقط spot_id + enabled را چک می‌کنیم
hasFluxWell: async (spotId: number) => {
  try {
    const { data, error } = await supabase
      .from("flux_wells")
      .select("id")
      .eq("spot_id", spotId)
      .maybeSingle();

    if (error) return { ok: false, error };
    return { ok: true, data: !!data };
  } catch (error) {
    return { ok: false, error };
  }
},


    async createFluxWell(regionId: number, spotId: number): Promise<DbResult<null>> {
      // regionId در اسکیمای شما وجود ندارد، پس ذخیره‌اش نمی‌کنیم
      const { error } = await supabase.from("flux_wells").insert({
        spot_id: spotId,
        enabled: true,
        kind: "fuel",
      });

      if (error) return { ok: false, error };
      return { ok: true, data: null };
    },
  };
}
