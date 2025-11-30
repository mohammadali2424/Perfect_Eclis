import { Context, SessionFlavor } from "grammy";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SessionData {
  ui_last_menu_id?: number;
  reg_step?: "clan" | "name";
  reg_clan?: string | null;
  reg_name?: string | null;
}

export interface Services {
  supabase: SupabaseClient<any, any, any>;
}

export type MyContext = Context & SessionFlavor<SessionData> & {
  services: Services;
};