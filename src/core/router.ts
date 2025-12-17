// src/core/router.ts
// Central callback router for structured cbq:v1:* callbacks.
// Backward compatible: legacy handlers can still be registered via bot.callbackQuery.

import type { Bot } from "grammy";
import type { MyContext } from "./types";
import { decodeCbq, type CbqV1 } from "./cbq";

export type CbqHandler = (ctx: MyContext, cbq: CbqV1) => Promise<void> | void;

type Key = string;

export class CallbackRouter {
  private handlers = new Map<Key, CbqHandler>();

  on(module: string, action: string, handler: CbqHandler): void {
    const k = `${module}:${action}`;
    if (this.handlers.has(k)) {
      console.warn(`[router] duplicate handler for ${k}`);
    }
    this.handlers.set(k, handler);
  }

  attach(bot: Bot<MyContext>): void {
    bot.on("callback_query:data", async (ctx, next) => {
      const data = ctx.callbackQuery.data;
      const parsed = decodeCbq(data);
      if (!parsed.ok) return next(); // let legacy callbackQuery handlers run

      const { module, action } = parsed.value;
      const k = `${module}:${action}`;
      const h = this.handlers.get(k);

      if (!h) {
        console.warn(`[router] unhandled cbq ${k}`);
        try { await ctx.answerCallbackQuery({ text: "این دکمه قدیمی/نامعتبر است." }); } catch {}
        return;
      }

      try {
        await h(ctx, parsed.value);
      } catch (err) {
        console.error("[router handler error]", err);
        try { await ctx.reply("یه خطای داخلی خوردیم. دوباره تلاش کن."); } catch {}
      } finally {
        try { await ctx.answerCallbackQuery(); } catch {}
      }
    });
  }
}
