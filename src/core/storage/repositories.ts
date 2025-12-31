import type { ChatId, Npc, Player, PlayerId, XpLedgerEntry } from '../types/entities.js';

export interface PlayerRepository {
  upsertPlayer(p: Pick<Player, 'id' | 'displayName' | 'username'>): Promise<Player>;
  getPlayer(id: PlayerId): Promise<Player | null>;
  setRoles(id: PlayerId, roles: string[]): Promise<void>;
  listPlayers(chatId?: ChatId): Promise<Player[]>;
  addXp(playerId: PlayerId, delta: number): Promise<Player>;
}

export interface NpcRepository {
  createNpc(npc: Omit<Npc, 'createdAt' | 'updatedAt'>): Promise<Npc>;
  updateNpc(id: string, patch: Partial<Npc>): Promise<Npc>;
  getNpc(id: string): Promise<Npc | null>;
  listNpcs(zone?: string): Promise<Npc[]>;
}

export interface XpLedgerRepository {
  add(entry: Omit<XpLedgerEntry, 'id' | 'createdAt'>): Promise<XpLedgerEntry>;
  listByPlayer(playerId: PlayerId, limit?: number): Promise<XpLedgerEntry[]>;
  listByChat(chatId: ChatId, sinceISO?: string): Promise<XpLedgerEntry[]>;
}

export interface UnitOfWork {
  players: PlayerRepository;
  npcs: NpcRepository;
  xpLedger: XpLedgerRepository;
}
