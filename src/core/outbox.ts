// src/core/outbox.ts
// Throttled message sender to protect against Telegram flood limits.
// - Per-chat min interval (different for private vs group)
// - Global max messages per second

import type { Api, RawApi } from "grammy";
import { OUTBOX_GLOBAL_MAX_PER_SEC, OUTBOX_GROUP_MIN_INTERVAL_MS, OUTBOX_PRIVATE_MIN_INTERVAL_MS } from "./config";

type ChatId = number;

type Job = {
  chatId: ChatId;
  kind: "private" | "group";
  run: () => Promise<any>;
};

export class Outbox {
  private q: Job[] = [];
  private lastSentAt = new Map<ChatId, number>();
  private tokens = OUTBOX_GLOBAL_MAX_PER_SEC;
  private lastTokenRefill = Date.now();
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.start();
  }

  enqueue(job: Job): void {
    this.q.push(job);
  }

  private start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 200);
  }

  private refillTokens(now: number) {
    const elapsed = now - this.lastTokenRefill;
    if (elapsed <= 0) return;
    const add = Math.floor(elapsed / 1000) * OUTBOX_GLOBAL_MAX_PER_SEC;
    if (add > 0) {
      this.tokens = Math.min(OUTBOX_GLOBAL_MAX_PER_SEC, this.tokens + add);
      this.lastTokenRefill = now;
    }
  }

  private minIntervalMs(kind: Job["kind"]) {
    return kind === "private" ? OUTBOX_PRIVATE_MIN_INTERVAL_MS : OUTBOX_GROUP_MIN_INTERVAL_MS;
  }

  private async tick() {
    const now = Date.now();
    this.refillTokens(now);
    if (this.tokens <= 0) return;
    if (this.q.length === 0) return;

    // Find the first job that is eligible (per-chat spacing)
    for (let i = 0; i < this.q.length; i++) {
      const job = this.q[i];
      const last = this.lastSentAt.get(job.chatId) ?? 0;
      const min = this.minIntervalMs(job.kind);
      if (now - last < min) continue;

      // consume
      this.q.splice(i, 1);
      this.tokens -= 1;
      this.lastSentAt.set(job.chatId, now);
      try {
        await job.run();
      } catch (err) {
        // swallow to keep queue moving
        console.error("[outbox] send error", err);
      }
      break;
    }
  }
}

// Singleton outbox for the whole process
export const outbox = new Outbox();

// Helper: identify chat kind
export function chatKindFromType(type?: string): "private" | "group" {
  return type === "private" ? "private" : "group";
}
