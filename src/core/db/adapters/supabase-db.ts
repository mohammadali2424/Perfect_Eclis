import { GameDb, DbResult } from "../repo";
import { DbCharacter, DbVehicle } from "../types";

export function makeSupabaseDb(supabase: any): GameDb {
  return {
    async getCharacterByTgId(
      tgId: number
    ): Promise<DbResult<DbCharacter | null>> {
      const { data, error } = await supabase
        .from("characters")
        .select("*")
        .eq("tg_id", tgId)
        .maybeSingle();

      if (error) return { ok: false, error };
      return { ok: true, data };
    },

    async updateCharacterById(
      id: number,
      patch: Partial<DbCharacter>
    ): Promise<DbResult<null>> {
      const { error } = await supabase
        .from("characters")
        .update(patch)
        .eq("id", id);

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

    async updateVehicleById(
      id: number,
      patch: Partial<DbVehicle>
    ): Promise<DbResult<null>> {
      const { error } = await supabase
        .from("vehicles")
        .update(patch)
        .eq("id", id);

      if (error) return { ok: false, error };
      return { ok: true, data: null };
    },

    // ✅ با ساختار واقعی جدول flux_wells
    // امضای تابع رو همون نگه می‌داریم که جای دیگه چیزی نشکنه
    async hasFluxWell(
      _regionId: number,
      spotId: number
    ): Promise<DbResult<boolean>> {
      const { data, error } = await supabase
        .from("flux_wells")
        .select("spot_id")
        .eq("spot_id", spotId)
        .eq("enabled", true)
        .eq("kind", "flux")
        .limit(1)
        .maybeSingle();

      if (error) return { ok: false, error };
      return { ok: true, data: !!data };
    },

    // ✅ ساخت چاه: region_id نداریم، id نداریم
    async createFluxWell(
      _regionId: number,
      spotId: number
    ): Promise<DbResult<null>> {
      const { error } = await supabase.from("flux_wells").insert({
        spot_id: spotId,
        kind: "flux",
        enabled: true,
      });

      if (error) return { ok: false, error };
      return { ok: true, data: null };
    },
  };
}
