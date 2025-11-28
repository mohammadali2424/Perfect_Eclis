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
  // PM حذف پیام قبلی
  __last_pm_id?: number;

  // حالت‌های ساخت Spot
  mode?: "create_spot" | "create_edge_time" | "edge_time" | undefined;

  pending_region_id?: string;

  // Edge ساخت مسیر
  edge_from_spot_id?: string;
  edge_to_spot_id?: string;

  // ویزارد ثبت نام
  reg_step?: "name" | "clan";
  reg_name?: string;
  reg_clan?: string;
}

export type MyContext = Context &
  SessionFlavor<SessionData> & {
    services: Services;
  };
