export interface Character {
  id: number;
  user_id: number;
  name: string;
  clan: string;
  current_region_id: number | null;
  current_spot_id: number | null;

  movement_mode: "walk" | "ride" | "drive" | "transport";

  current_vehicle_instance_id?: number | null;
  current_mount_instance_id?: number | null;

  picking_target?: number | null;
  picked_by?: number | null;

  carry_capacity: number;
}
