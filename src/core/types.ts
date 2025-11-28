// src/core/types.ts

// حالت حرکت
export type MovementMode = "walk" | "ride" | "drive" | "transport";

// چهار خاندان
export type ClanId = "walker" | "stellarieth" | "necroshade" | "torrentress";

// ریجن = یک منطقه (مثلا یک گروه)
export interface WorldRegion {
  id: string;
  name: string;
  clan: ClanId;
  chat_id: string; // آیدی گروه تلگرام
}

// Spot = یک مکان داخل یک ریجن
export interface WorldSpot {
  id: string;
  title: string;
  region_id: string;
  chat_id: string | null; // فعلاً معمولا همون chat_id ریجن
}

// Edge = مسیر بین دو Spot
export interface WorldEdge {
  id: string;
  from_spot_id: string;
  to_spot_id: string;
  base_travel_seconds: number;
  can_walk: boolean;
  can_ride: boolean;
  can_drive: boolean;
  can_transport: boolean;
}

// دیتاهای سشن
export interface SessionData {
  movementMode: MovementMode;
  __lastPmMessageId: number | null;

  // پنل ساخت جهان
  worldBuilderMode?:
    | "create_spot_name"
    | "create_edge_time"
    | "idle";
  worldBuilderPayload?: any;
  worldBuilderRegionId?: string | null;
  worldBuilderRegionChatId?: string | null;
  worldBuilderRegionTitle?: string | null;

  // سفر (فعلاً برای سیستم Travel)
  travelEdgeId: string | null;
  travelStartAt: number | null;
  travelEta: number | null;
}
