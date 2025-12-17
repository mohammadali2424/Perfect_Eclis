// src/core/galaxy-bot.ts
import type { Bot, Context, Filter, MiddlewareFn } from "grammy";

/**
 * Wraps bot.callbackQuery to:
 * - provide a uniform error boundary
 * - always answerCallbackQuery (to avoid Telegram "loading..." forever)
 * - warn on duplicate registrations (a classic source of "it sometimes works")
 *
 * Everything else is proxied through untouched.
 */
export function createGalaxyBot<TContext extends Context>(bot: Bot<TContext>) {
  const seen = new Map<string, number>();

  function keyOf(trigger: any): string {
    if (typeof trigger === "string") return `str:${trigger}`;
    if (trigger instanceof RegExp) return `re:${trigger.toString()}`;
    return `other:${String(trigger)}`;
  }

  function wrapHandler(handler: any): any {
    return async (ctx: any) => {
      try {
        await handler(ctx);
      } catch (err) {
        console.error("[HANDLER ERROR]", err);
        try { await ctx.reply("یه خطای داخلی خوردیم. دوباره تلاش کن."); } catch {}
      } finally {
        try { await ctx.answerCallbackQuery(); } catch {}
      }
    };
  }

  return new Proxy(bot as any, {
    get(target, prop, receiver) {
      if (prop === "callbackQuery") {
        return (trigger: any, ...rest: any[]) => {
          const handler = rest.pop();
          const middleware = wrapHandler(handler);

          const k = keyOf(trigger);
          const n = (seen.get(k) ?? 0) + 1;
          seen.set(k, n);
          if (n > 1) {
            console.warn(`[DUP CBQ] ${k} registered ${n} times`);
          }

          return target.callbackQuery(trigger, ...rest, middleware);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
