import { Context } from "grammy";
import { SessionFlavor } from "grammy";
import { SupabaseClient } from "@supabase/supabase-js";
import type { makeSupabaseDb } from "./db/adapters/supabase-db";

export interface SessionData {
  reg_step?: "clan" | "name";
  reg_clan?: string | null;
  reg_name?: string | null;

  ui_last_menu_id?: number;

  // ---- UI / Flows ----
  // سوخت‌گیری درصد دلخواه (wizard ساده)
  fuel_custom_waiting?: boolean;

  // برای مدیریت پیام‌های UI (edit/delete) بدون any
  ui_last_message_id?: number;

  admin_mode?: "add_spot" | "add_edge_time";
  admin_region_id?: number;
  admin_from_spot_id?: number;
  admin_to_spot_id?: number;
  admin_edge_twosided?: boolean;
}

export interface Services {
  supabase: SupabaseClient<any, any, any>;
  db: ReturnType<typeof makeSupabaseDb>;
}

export type MyContext = Context &
  SessionFlavor<SessionData> & {
    services: Services;
  };

