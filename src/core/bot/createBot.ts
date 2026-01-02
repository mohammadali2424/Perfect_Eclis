import { Telegraf } from 'telegraf';

import type { CommandRegistry } from '../commands/registry.js';
import type { Logger } from '../utils/logger.js';
import type { UnitOfWork } from '../storage/repos.js';
import { createCommandRouter } from './commandRouter.js';

export function createBot(opts: {
  token: string;
  registry: CommandRegistry;
  uowFactory: () => UnitOfWork;
  logger: Logger;
}) {
  const bot = new Telegraf(opts.token);

  // Router (بدون اسلش)
  bot.use(
    createCommandRouter({
      registry: opts.registry,
      uowFactory: opts.uowFactory,
      logger: opts.logger
    })
  );

  return bot;
}
