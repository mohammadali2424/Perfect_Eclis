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

export type XpReason =
  | 'quest'
  | 'combat'
  | 'trade'
  | 'admin_adjustment'
  | 'other';

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
