import type { Context } from 'telegraf';
import { parseCommand } from './parseCommand.js';
import type { UnitOfWork } from '../storage/unitOfWork.js';
import type { CommandRegistry } from '../commands/registry.js';

export type CommandCtx = Context & {
  uow: UnitOfWork;
};

export function createCommandRouter(registry: CommandRegistry) {
  // gather aliases (including command names)
  const aliases = registry
    .listCommands()
    .flatMap((c) => [c.name, ...(c.aliases ?? [])])
    .filter(Boolean);

  return async (ctx: CommandCtx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    if (!text) return;

    const parsed = parseCommand(text, aliases);
    if (!parsed) return;

    const def = registry.getCommand(parsed.name);
    if (!def) return;

    await def.handler(ctx, parsed.args);
  };
}
