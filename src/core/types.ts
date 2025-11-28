import { Context, SessionFlavor } from "grammy";
import type { SupabaseClient } from "@supabase/supabase-js";

// هر چیزی که میخوایم تو سشن نگه داریم
export interface SessionData {
  // حالت ویزارد ادمین
  mode?: "create_spot" | "edge_time";

  // برای ساخت Spot
  pending_region_id?: number;

  // برای ساخت Edge
  edge_from_spot_id?: number;
  edge_to_spot_id?: number;

  // برای آخرین پیام مدیریتی در پی‌وی (پنل worldadmin)
  __last_pm_id?: number;

  // برای منوهای فانتزی PV (اطلس، ثبت‌نام و...)
  ui_last_menu_id?: number;

  // ویزارد ثبت‌نام (onboarding)
  reg_step?: "clan" | "name";
  reg_clan?: string | null;
  reg_name?: string | null;
}

// سرویس‌هایی که به ctx تزریق می‌کنیم
export interface Services {
  supabase: SupabaseClient;
}

// کانتکست اصلی بات
export type MyContext = Context & SessionFlavor<SessionData> & {
  services: Services;
};
