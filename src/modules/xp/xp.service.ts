import type { EventBus } from '../../core/events/eventBus.js';
import { randomUUID } from 'crypto';
import type { XpEntry } from './xp.types.js';

/**
 * Phase 1: in-memory. Phase 2: replace with repository (Supabase/Postgres) without touching commands.
 */
export class XpService {
  private entries: XpEntry[] = [];

  constructor(private readonly bus: EventBus) {}

  add(chatId: number, userId: number, delta: number, reason: string) {
    const e: XpEntry = {
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

  sum(chatId: number, userId: number) {
    return this.entries
      .filter(e => e.chatId === chatId && e.userId === userId)
      .reduce((a, b) => a + b.delta, 0);
  }

  recent(chatId: number, limit = 20) {
    return this.entries.filter(e => e.chatId === chatId).slice(-limit);
  }
}
