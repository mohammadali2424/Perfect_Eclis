
import { Context, SessionFlavor } from "grammy";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * سرویس‌هایی که توی ctx.services تزریق می‌کنیم
 */
export interface Services {
  supabase: SupabaseClient;
}

/**
 * شکل رکورد کاراکتر داخل دیتابیس (جدول characters)
 */
export interface CharacterState {
  id: number;
  tg_id: number;
  char_name: string | null;
  clan_name?: string | null;
  current_region_id: string | null;
  current_spot_id: number | null;
  last_move_at: string | null;
  travel_ready_at: string | null;
}

/**
 * سشن اختصاصی پنل ساخت دنیا (world admin)
 */
export interface WorldAdminSession {
  mode?:
    | "idle"
    | "create_spot"
    | "select_edge_from"
    | "select_edge_to"
    | "edge_time"
    | "delete_from";
  regionChatId?: number | null;
  regionId?: number | null;
  fromSpotId?: number | null;
  toSpotId?: number | null;
}

/**
 * کل چیزی که توی ctx.session نگه می‌داریم
 */
export interface SessionData {
  __last_pm_id?: number;
  worldAdmin?: WorldAdminSession;
  ui_last_menu_id?: number;

  reg_step?: "clan" | "name";
  reg_clan?: string | null;
  reg_name?: string | null;
}

/**
 * کانتکست اختصاصی بات، شامل سشن و سرویس‌ها
 */
export type MyContext = Context &
  SessionFlavor<SessionData> & {
    services: Services;
  };
