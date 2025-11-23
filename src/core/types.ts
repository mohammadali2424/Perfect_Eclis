import { Context, SessionFlavor } from "grammy";
import { SupabaseClient } from "@supabase/supabase-js";

export interface Services {
  supabase: SupabaseClient;
  masterId: number;
}

export interface CharacterState {
  tg_id: number;
  char_name: string | null;
  current_region_id: string | null;
  current_spot_id: string | null;
  last_move_at: string | null;
  travel_ready_at: string | null; // ISO string when travel finishes
  pending_region_id: string | null; // مقصد سفر
  pending_spot_id: string | null;   // مقصد سفر
}

export interface SessionData {
  // بعداً برای پنل اینلاین مستر ازش استفاده می‌کنیم
}

export type MyContext = Context &
  SessionFlavor<SessionData> & {
    services: Services;
  };
