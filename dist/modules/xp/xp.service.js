import { randomUUID } from 'crypto';
/**
 * Phase 1: in-memory. Phase 2: replace with repository (Supabase/Postgres) without touching commands.
 */
export class XpService {
    bus;
    entries = [];
    constructor(bus) {
        this.bus = bus;
    }
    add(chatId, userId, delta, reason) {
        const e = {
            id: randomUUID(),
            chatId,
            userId,
            delta,
            reason,
            createdAt: new Date().toISOString()
        };
        this.entries.push(e);
        void this.bus.emit('xp.changed', e);
        return e;
    }
    sum(chatId, userId) {
        return this.entries
            .filter(e => e.chatId === chatId && e.userId === userId)
            .reduce((a, b) => a + b.delta, 0);
    }
    recent(chatId, limit = 20) {
        return this.entries.filter(e => e.chatId === chatId).slice(-limit);
    }
}
