import type { Context, MiddlewareFn } from 'telegraf';
import type { CommandRegistry } from '../commands/registry.js';
import type { Logger } from '../utils/logger.js';
import type { UnitOfWork } from '../storage/repos.js';

function extractCommand(text: string): { name: string; args: string } | null {
  const m = text.trim().match(/^\/(\S+)(?:\s+(.*))?$/s);
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: (m[2] ?? '').trim() };
}

export function createCommandRouter(opts: {
  registry: CommandRegistry;
  uow: UnitOfWork;
  logger: Logger;
}): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    if (!text || !text.startsWith('/')) return next();

    const parsed = extractCommand(text);
    if (!parsed) return next();

    const cmd = opts.registry.get(parsed.name);
    if (!cmd) return next();

    // attach args for handlers
    (ctx as any).argsText = parsed.args;

    try {
      await cmd.handler(ctx, { uow: opts.uow, logger: opts.logger });
    } catch (err) {
      opts.logger.error('Command failed', { cmd: parsed.name, err });
      await ctx.reply('❌ خطا در اجرای دستور. لاگ ثبت شد.');
    }
  };
}
