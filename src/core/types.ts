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
  travel_ready_at: string | null;
  pending_region_id: string | null;
  pending_spot_id: string | null;
}

export interface SessionData {
  // برای تمیز نگه داشتن PM
  __last_pm_id?: number;

  // حالت‌های ساخت دنیا
  mode?: "create_spot" | "edge_time";

  pending_region_id?: string;
  edge_from_spot_id?: string;
  edge_to_spot_id?: string;

 ui_last_menu_id?: number;

  // ویزارد ثبت‌نام بازیکن
  reg_step?: "clan" | "name";
  reg_clan?: string | null;
  reg_name?: string | null;
}

export type MyContext = Context &
  SessionFlavor<SessionData> & {
    services: Services;
  };
