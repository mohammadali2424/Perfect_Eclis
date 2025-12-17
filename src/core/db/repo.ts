import { DbCharacter, DbVehicle } from "./types";

export type DbResult<T> = { ok: true; data: T } | { ok: false; error: any };

export interface GameDb {
  // characters
  getCharacterByTgId(tgId: number): Promise<DbResult<DbCharacter | null>>;
  updateCharacterById(id: number, patch: Partial<DbCharacter>): Promise<DbResult<null>>;

  // vehicles
  getVehicleById(id: number): Promise<DbResult<DbVehicle | null>>;
  updateVehicleById(id: number, patch: Partial<DbVehicle>): Promise<DbResult<null>>;

  // flux wells
 // flux wells
hasFluxWell(spotId: number, kind?: "normal" | "emergency"): Promise<DbResult<boolean>>;
createFluxWell(spotId: number, kind: "normal" | "emergency"): Promise<DbResult<null>>;

}
