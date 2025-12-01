import { Context } from "grammy";
import { SessionFlavor } from "grammy";
import { SupabaseClient } from "@supabase/supabase-js";

export interface SessionData {
  // ثبت‌نام
  reg_step?: "clan" | "name";
  reg_clan: string | null;
  reg_name: string | null;

  // برای UI اگر بعداً خواستی
  ui_last_menu_id?: number;

  // پنل ادمین جهان‌ساز
  admin_mode?: "add_spot" | "add_edge_time";
  admin_region_id?: number;
  admin_from_spot_id?: number;
  admin_to_spot_id?: number;
  admin_edge_twosided?: boolean; // مسیر دوطرفه یا نه
}

export interface Services {
  supabase: SupabaseClient<any, any, any>;
}

export type MyContext = Context &
  SessionFlavor<SessionData> & {
    services: Services;
  };
