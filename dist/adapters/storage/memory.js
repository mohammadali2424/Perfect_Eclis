function isoNow() {
    return new Date().toISOString();
}
export class MemoryPlayerRepo {
    byId = new Map();
    async getOrCreateFromTelegram(user) {
        const existing = this.byId.get(user.id);
        if (existing) {
            const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || existing.displayName;
            const updated = {
                ...existing,
                username: user.username ?? existing.username,
                displayName,
                updatedAt: isoNow(),
            };
            this.byId.set(user.id, updated);
            return updated;
        }
        const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || (user.username ? `@${user.username}` : `User ${user.id}`);
        const created = {
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
    async getById(id) {
        return this.byId.get(id) ?? null;
    }
    async update(player) {
        const existing = this.byId.get(player.id);
        if (!existing)
            throw new Error('Player not found');
        const merged = { ...existing, ...player, updatedAt: isoNow() };
        this.byId.set(player.id, merged);
        return merged;
    }
}
export class MemoryXpLedgerRepo {
    entries = [];
    async add(entry) {
        const created = {
            ...entry,
            id: `${entry.chatId}:${entry.playerId}:${this.entries.length + 1}`,
            createdAt: isoNow(),
        };
        this.entries.push(created);
        return created;
    }
    async listByChat(chatId, opts) {
        const since = opts?.sinceIso ? new Date(opts.sinceIso).getTime() : -Infinity;
        const limit = opts?.limit ?? Infinity;
        return this.entries
            .filter((e) => e.chatId === chatId && new Date(e.createdAt).getTime() >= since)
            .slice()
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, limit);
    }
    async summarize(chatId, opts) {
        const list = await this.listByChat(chatId, opts);
        const map = new Map();
        for (const e of list)
            map.set(e.playerId, (map.get(e.playerId) ?? 0) + e.amount);
        return Array.from(map.entries()).map(([playerId, xp]) => ({ playerId, xp }));
    }
}
export class MemoryNpcRepo {
    byId = new Map();
    async getById(id) {
        return this.byId.get(id) ?? null;
    }
    async upsert(npc) {
        this.byId.set(npc.id, npc);
        return npc;
    }
}
export class MemoryUow {
    players = new MemoryPlayerRepo();
    xp = new MemoryXpLedgerRepo();
    npcs = new MemoryNpcRepo();
}
// Back-compat alias (the scaffold's main.ts imports this name)
export { MemoryUow as MemoryUnitOfWork };
