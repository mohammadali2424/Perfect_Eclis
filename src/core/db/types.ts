export type DbVehicle = {
  id: number;
  title: string | null;
  display_name: string | null;
  owner_char_id: number | null;
  current_driver_char_id: number | null;
  current_region_id: number | null;
  current_spot_id: number | null;
  fuel_percent: number | null;
  capacity: number | null;
  passenger_locked: boolean | null;
};

export type DbCharacter = {
  id: number;
  tg_id: number | null;
  char_name: string | null;
  current_region_id: number | null;
  current_spot_id: number | null;
  pending_region_id: number | null;
  pending_spot_id: number | null;
  travel_ready_at: string | null;
  travel_total_seconds: number | null;
  travel_started_at: string | null;
  last_move_at: string | null;
  riding_vehicle_id: number | null;
};

export type DbFluxWell = {
  id: number;
  region_id: number;
  spot_id: number;
};
