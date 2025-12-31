import type { MiddlewareFn } from 'telegraf';
import type { Context } from 'telegraf';
import type { UnitOfWork } from '../storage/repos.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { Logger } from '../logger/logger.js';

type RouterCtx = Context & { uow: UnitOfWork };

function isTextMessage(ctx: Context): ctx is Context & { message: { text: string } } {
  return Boolean((ctx as any).message?.text);
}

export function createCommandRouter(opts: {
  registry: CommandRegistry;
  uowFactory: () => UnitOfWork;
  logger: Logger;
}): MiddlewareFn<Context> {
  const { registry, uowFactory, logger } = opts;

  return async (ctx, next) => {
    if (!isTextMessage(ctx)) return next();

    const text = ctx.message.text.trim();
    if (!text) return next();

    // فرمان‌ها بدون اسلش: اولین توکن را command می‌گیریم
    const [head] = text.split(/\s+/);
    const cmd = head.toLowerCase();

    const def = registry.get(cmd);
    if (!def) return next();

    // attach uow
    (ctx as RouterCtx).uow = uowFactory();

    try {
      await def.handler(ctx as RouterCtx, { uow: (ctx as RouterCtx).uow, logger });
    } catch (err) {
      logger.error('command handler failed', { cmd, err });
      await ctx.reply('خطای داخلی در اجرای دستور.');
    }
  };
}
