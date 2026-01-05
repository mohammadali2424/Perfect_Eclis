export type WorldTier = "T1" | "T2" | "T3";

// Tag آزاد است، ولی عرف: UPPER_SNAKE یا UPPER (مثل CITY / CAPTURE / WAR)
export type WorldTag = string;

export interface WorldEvent {
  ts?: string;            // ISO
  tier: WorldTier;        // T1 مهم
  tags: WorldTag[];       // برای جستجو/دسته‌بندی
  title: string;          // تیتر کوتاه
  summary?: string;       // توضیح کامل‌تر (اختیاری)

  // مکان
  region?: string;
  spot?: string;
  zone?: string;

  // نمایشگرها (fallback)
  actorLabel?: string;
  targetLabel?: string;

  // دیتا آزاد برای formatter/bridge/سیستم‌ها
  meta?: Record<string, any>;
}
