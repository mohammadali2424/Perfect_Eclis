// src/core/db/adapters/supabase-db.ts
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

    // ✅ این همون hasFluxWell درست است (بدون select("id"))
    async hasFluxWell(regionId: number, spotId: number): Promise<DbResult<boolean>> {
      const { data, error } = await supabase
        .from("flux_wells")
        .select("region_id") // یا select("*") هم اوکیه
        .eq("region_id", regionId)
        .eq("spot_id", spotId)
        .maybeSingle();

      if (error) return { ok: false, error };
      return { ok: true, data: !!data };
    },

    async createFluxWell(
      regionId: number,
      spotId: number
    ): Promise<DbResult<null>> {
      const { error } = await supabase
        .from("flux_wells")
        .insert({ region_id: regionId, spot_id: spotId });

      if (error) return { ok: false, error };
      return { ok: true, data: null };
    },
  };
}
