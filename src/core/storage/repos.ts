import type { ChatId, Npc, Player, PlayerId, XpLedgerEntry } from '../types/entities.js';

export interface PlayerRepo {
  getOrCreateFromTelegram(user: {
    id: PlayerId;
    username?: string;
    first_name?: string;
    last_name?: string;
  }): Promise<Player>;

  getById(id: PlayerId): Promise<Player | null>;
  update(player: Partial<Player> & { id: PlayerId }): Promise<Player>;
}

export interface XpLedgerRepo {
  add(entry: Omit<XpLedgerEntry, 'id' | 'createdAt'>): Promise<XpLedgerEntry>;
  listByChat(chatId: ChatId, opts?: { sinceIso?: string }): Promise<XpLedgerEntry[]>;
  summarize(chatId: ChatId, opts?: { sinceIso?: string }): Promise<Array<{ playerId: PlayerId; xp: number }>>;
}

export interface NpcRepo {
  getById(id: string): Promise<Npc | null>;
  upsert(npc: Npc): Promise<Npc>;
}

export interface UnitOfWork {
  players: PlayerRepo;
  xp: XpLedgerRepo;
  npcs: NpcRepo;
}
