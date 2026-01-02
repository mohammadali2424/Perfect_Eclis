import type { UnitOfWork, PlayerRepo, XpLedgerRepo, NpcRepo } from '../../core/storage/repos.js';
import type { ChatId, Npc, Player, PlayerId, XpLedgerEntry } from '../../core/types/entities.js';

function isoNow() {
  return new Date().toISOString();
}

export class MemoryPlayerRepo implements PlayerRepo {
  private byId = new Map<PlayerId, Player>();

  async getOrCreateFromTelegram(user: {
    id: PlayerId;
    username?: string;
    first_name?: string;
    last_name?: string;
  }): Promise<Player> {
    const existing = this.byId.get(user.id);
    if (existing) {
      const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || existing.displayName;
      const updated: Player = {
        ...existing,
        username: user.username ?? existing.username,
        displayName,
        updatedAt: isoNow(),
      };
      this.byId.set(user.id, updated);
      return updated;
    }

    const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || (user.username ? `@${user.username}` : `User ${user.id}`);
    const created: Player = {
      id: user.id,
      username: user.username ?? null,
      displayName,
      createdAt: isoNow(),
      updatedAt: isoNow(),
      xp: 0,
      lvl: 1,
      roles: [],
    };
    this.byId.set(user.id, created);
    return created;
  }

  async getById(id: PlayerId): Promise<Player | null> {
    return this.byId.get(id) ?? null;
  }

  async update(player: Partial<Player> & { id: PlayerId }): Promise<Player> {
    const existing = this.byId.get(player.id);
    if (!existing) throw new Error('Player not found');
    const merged: Player = { ...existing, ...player, updatedAt: isoNow() };
    this.byId.set(player.id, merged);
    return merged;
  }

  async listAdmins(): Promise<Player[]> {
    return [...this.byId.values()].filter((p) => Array.isArray(p.roles) && p.roles.includes('admin'));
  }
}

export class MemoryXpLedgerRepo implements XpLedgerRepo {
  private entries: XpLedgerEntry[] = [];

  async add(entry: Omit<XpLedgerEntry, 'id' | 'createdAt'>): Promise<XpLedgerEntry> {
    const created: XpLedgerEntry = {
      ...entry,
      id: `${entry.chatId}:${entry.playerId}:${this.entries.length + 1}`,
      createdAt: isoNow(),
    };
    this.entries.push(created);
    return created;
  }

  async listByChat(chatId: ChatId, opts?: { sinceIso?: string; limit?: number }): Promise<XpLedgerEntry[]> {
    const since = opts?.sinceIso ? new Date(opts.sinceIso).getTime() : -Infinity;
    const limit = opts?.limit ?? Infinity;
    return this.entries
      .filter((e) => e.chatId === chatId && new Date(e.createdAt).getTime() >= since)
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  async summarize(chatId: ChatId, opts?: { sinceIso?: string }): Promise<Array<{ playerId: PlayerId; xp: number }>> {
    const list = await this.listByChat(chatId, opts);
    const map = new Map<PlayerId, number>();
    for (const e of list) map.set(e.playerId, (map.get(e.playerId) ?? 0) + e.amount);
    return Array.from(map.entries()).map(([playerId, xp]) => ({ playerId, xp }));
  }
}

export class MemoryNpcRepo implements NpcRepo {
  private byId = new Map<string, Npc>();

  async getById(id: string): Promise<Npc | null> {
    return this.byId.get(id) ?? null;
  }

  async upsert(npc: Npc): Promise<Npc> {
    this.byId.set(npc.id, npc);
    return npc;
  }
}

export class MemoryUow implements UnitOfWork {
  public players = new MemoryPlayerRepo();
  public xp = new MemoryXpLedgerRepo();
  public npcs = new MemoryNpcRepo();
}

// Back-compat alias (the scaffold's main.ts imports this name)
export { MemoryUow as MemoryUnitOfWork };
