// src/core/types.ts

import { Context, SessionFlavor } from "grammy";
import type { SupabaseClient } from "@supabase/supabase-js";

// دیتاهایی که توی session نگه می‌داریم
export interface SessionData {
  // اگر قبلاً چیزهایی داشتی می‌تونی بعداً اضافه کنیم
  // الان فقط چیزهایی که واقعاً داریم استفاده می‌کنیم:

  // برای پاک کردن آخرین منوی PV (اطلس، منوها و...)
  ui_last_menu_id?: number;

  // ویزارد ثبت‌نام (onboarding)
  // null = هنوز چیزی انتخاب نشده
  reg_step?: "clan" | "name"; // مرحله فعلی: انتخاب خاندان یا نوشتن اسم
  reg_clan?: string | null;   // نام خاندان انتخاب‌شده
  reg_name?: string | null;   // نام کاراکتر موقت قبل از ثبت نهایی
}

// سرویسی که توی ctx.services نگه می‌داریم
export interface Services {
  supabase: SupabaseClient<any, any, any>;
}

// کانتکست اصلی ربات
export type MyContext = Context &
  SessionFlavor<SessionData> & {
    services: Services;
  };
