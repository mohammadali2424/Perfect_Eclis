export type PlayerId = number; // Telegram user id
export type ChatId = number;

export interface Player {
  id: PlayerId;
  username?: string | null;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  xp: number;
  lvl: number;
  roles: string[]; // e.g. ['admin','gm']
}

export interface Npc {
  id: string;
  name: string;
  family?: string | null;
  race?: string | null;
  role: string;
  homeSpot?: string | null;
  currentZone?: string | null;
  loyalty: 'low' | 'medium' | 'high';
  morale: 'afraid' | 'normal' | 'motivated';
  state: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * XP reason is intentionally free-form (Persian-friendly) so GMs can log anything.
 * If you later need strict categories, add a separate `reasonTag` field.
 */
export type XpReason = string;

export interface XpLedgerEntry {
  id: string;
  playerId: PlayerId;
  chatId: ChatId;
  amount: number;
  reason: XpReason;
  note?: string | null;
  createdAt: string;
  createdBy: PlayerId;
}
