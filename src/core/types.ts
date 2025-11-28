export type MovementMode = "walk" | "ride" | "drive" | "transport";

export interface SessionData {
  // آخرین وضعیت ساخت مسیر برای ادمین
  worldBuilderMode?: "create_spot" | "create_edge" | "create_edge_time";
  worldBuilderPayload?: Record<string, any>;

  // وضعیت سفر
  travelEdgeId?: string | null;
  travelStartAt?: number | null;
  travelEta?: number | null;

  // حالت‌های حرکت
  movementMode?: MovementMode;

  // آخرین منوی خصوصی برای تمیز بودن پی‌وی
  __lastPmMessageId?: number | null;
}

export interface CharacterLocation {
  region_id: string;
  spot_id: string;
}

export interface WorldSpot {
  id: string;
  title: string;
  region_id: string;
  chat_id: string;
  is_spawn?: boolean;
}

export interface WorldEdge {
  id: string;
  from_spot_id: string;
  to_spot_id: string;
  // ثانیه
  base_travel_seconds: number;
  // چه حالت‌هایی مجازند
  can_walk: boolean;
  can_ride: boolean;
  can_drive: boolean;
  can_transport: boolean;
}
