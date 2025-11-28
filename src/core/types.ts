// src/core/types.ts
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
 * اگر خواستی می‌تونی دقیق‌ترش کنی بر اساس اسکیمای سوپابیس.
 */
export interface CharacterState {
  tg_id: number;
  char_name: string | null;
  clan_name?: string | null;
  current_region_id: number | null;
  current_spot_id: number | null;
  last_move_at: string | null;
  travel_ready_at: string | null;
}

/**
 * سشن اختصاصی پنل ساخت دنیا (world admin)
 * بیشترش رو admin-builder با @ts-ignore استفاده می‌کنه،
 * اینجا فقط برای نظم و تایپ‌سیفتی تعریف شده.
 */
export interface WorldAdminSession {
  mode?: "idle" | "create_spot" | "select_edge_from" | "select_edge_to" | "edge_time";
  regionChatId?: number | null;
  regionId?: number | null;
  fromSpotId?: number | null;
  toSpotId?: number | null;
}

/**
 * کل چیزی که توی ctx.session نگه می‌داریم
 */
export interface SessionData {
  /**
   * برای اینکه پی‌وی تمیز بمونه: آخرین پیام منو/پنل که باید پاک بشه
   */
  __last_pm_id?: number;

  /**
   * وضعیت پنل دنیاسازی /worldadmin
   * خود admin-builder مقداردهی‌اش می‌کنه.
   */
  worldAdmin?: WorldAdminSession;

  /**
   * اگر خواستی منوهای مختلف توی پی‌وی داشته باشی
   * می‌تونی آخرین msg_id رو برای ادیت/پاک‌کردن نگه داری
   */
  ui_last_menu_id?: number;

  /**
   * ویزارد ثبت‌نام بازیکن (registration.ts)
   */
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
