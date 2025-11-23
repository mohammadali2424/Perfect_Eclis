import { Context, SessionFlavor } from "grammy";
import { SupabaseClient } from "@supabase/supabase-js";

export interface Services {
  supabase: SupabaseClient;
  masterId: number;
}

export interface CharacterState {
  tg_id: number;
  char_name: string | null;
  clan_name?: string | null;
  current_region_id: string | null;
  current_spot_id: string | null;
  last_move_at: string | null;
  travel_ready_at: string | null; // ISO string when travel finishes
  pending_region_id: string | null; // مقصد سفر
  pending_spot_id: string | null;   // مقصد سفر
}

export interface SessionData {
  // ویزارد ساخت جهان
  mode?: "create_spot" | "create_edge_time";

  pending_region_id?: string;
  edge_from_spot_id?: string;
  edge_to_spot_id?: string;

  // ویزارد ثبت‌نام
  reg_step?: "name" | "clan";
  reg_name?: string;
  reg_clan?: string;
}

export type MyContext = Context &
  SessionFlavor<SessionData> & {
    services: Services;
  };
