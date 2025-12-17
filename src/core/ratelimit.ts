// src/core/ratelimit.ts
// Tiny in-memory rate limiter middleware (no extra deps).
// Protects Supabase + Telegram from spammy users/click storms.

import type { MiddlewareFn } from "grammy";
import type { MyContext } from "./types";

type Key = string;
type Bucket = { tokens: number; last: number };

export type RateLimitOptions = {
  // tokens per second
  rate: number;
  // max burst tokens
  burst: number;
  // compute key: default is per-user
  key?: (ctx: MyContext) => string | null;
  // optional reject message (callback queries should use answerCallbackQuery)
  onReject?: (ctx: MyContext) => Promise<void> | void;
};

export function rateLimit(opts: RateLimitOptions): MiddlewareFn<MyContext> {
  const buckets = new Map<Key, Bucket>();
  const rate = Math.max(0.1, opts.rate);
  const burst = Math.max(1, opts.burst);
  const keyFn = opts.key ?? ((ctx: MyContext) => (ctx.from?.id ? `u:${ctx.from.id}` : null));

  return async (ctx, next) => {
    const key = keyFn(ctx);
    if (!key) return next();

    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: burst, last: now };
    const elapsed = Math.max(0, now - b.last) / 1000;
    b.tokens = Math.min(burst, b.tokens + elapsed * rate);
    b.last = now;
    buckets.set(key, b);

    if (b.tokens < 1) {
      if (opts.onReject) await opts.onReject(ctx);
      return;
    }
    b.tokens -= 1;
    return next();
  };
}
