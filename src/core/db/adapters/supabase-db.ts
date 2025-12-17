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

    async updateCharacterById(
      id: number,
      patch: Partial<DbCharacter>
    ): Promise<DbResult<null>> {
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

    async updateVehicleById(
      id: number,
      patch: Partial<DbVehicle>
    ): Promise<DbResult<null>> {
      const { error } = await supabase.from("vehicles").update(patch).eq("id", id);
      if (error) return { ok: false, error };
      return { ok: true, data: null };
    },

    // ✅ فقط اگر (spot_id=...) و enabled=true و kind='fuel' باشد
  // ✅ اگر در این spot هر چاه فعالی هست (با هر kind) → true
hasFluxWell: async (spotId: number, kind: "normal" | "emergency" = "normal") => {
  const { data, error } = await supabase
    .from("flux_wells")
    .select("id, enabled")
    .eq("spot_id", spotId)
    .eq("kind", kind)
    .maybeSingle();

  if (error) return { ok: false, error };
  return { ok: true, data: !!data && !!data.enabled };
},

createFluxWell: async (spotId: number, kind: "normal" | "emergency") => {
  const { error } = await supabase
    .from("flux_wells")
    .upsert(
      { spot_id: spotId, kind, enabled: true },
      { onConflict: "spot_id,kind" }
    );

  if (error) return { ok: false, error };
  return { ok: true, data: null };
},
  };
}
