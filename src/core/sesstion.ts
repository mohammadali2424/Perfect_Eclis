import { SessionFlavor } from "grammy";

export interface SessionData {
    current_spot?: number;

    // UI memory (برای پاک کردن منوهای قبلی)
    ui_last_menu_id?: number;

    // ثبت‌نام
    reg_step?: number;     // 0 = شروع، 1 = انتخاب خاندان، 2 = نام
    reg_clan?: string | null;
    reg_name?: string | null;
}

export type MyContext = SessionFlavor<SessionData>;
