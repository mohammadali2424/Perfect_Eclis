import { Telegraf } from 'telegraf';
import type { CommandRegistry } from '../commands/registry.js';
import { createCommandRouter } from './commandRouter.js';
import type { Logger } from '../utils/logger.js';
import type { UnitOfWork } from '../storage/repos.js';

export function createBot(opts: {
  token: string;
  registry: CommandRegistry;
  uow: UnitOfWork;
  logger: Logger;
}): Telegraf {
  const bot = new Telegraf(opts.token);

  // Minimal: ensure we have player record on any incoming message
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      await opts.uow.players.getOrCreateFromTelegram(ctx.from);
    }
    return next();
  });

  bot.use(createCommandRouter({ registry: opts.registry, uow: opts.uow, logger: opts.logger }));

  bot.catch((err, ctx) => {
    opts.logger.error('Bot error', { err: String(err), update: ctx.updateType });
  });

  return bot;
}
