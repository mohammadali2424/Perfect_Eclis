import type { Context } from 'telegraf';
import type { CommandRegistry } from './command.js';
import type { Logger } from '../utils/logger.js';
import type { UnitOfWork } from '../storage/repos.js';

// Parses Telegram bot commands: /cmd arg1 arg2...
// Supports Persian aliases if registered.
export async function dispatchCommand(
  ctx: Context,
  deps: { registry: CommandRegistry; uow: UnitOfWork; logger: Logger }
): Promise<boolean> {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  if (!text.startsWith('/')) return false;

  const [rawCmd] = text.split(/\s+/, 1);
  const cmdName = rawCmd.replace(/^\//, '').split('@')[0];
  const cmd = deps.registry.get(cmdName);
  if (!cmd) return false;

  await cmd.handler(ctx, { uow: deps.uow, logger: deps.logger });
  return true;
}
