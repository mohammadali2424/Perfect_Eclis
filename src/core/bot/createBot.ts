import { Telegraf } from 'telegraf';
import type { CommandRegistry } from '../commands/registry.js';
import { createCommandRouter } from './commandRouter.js';
import type { Logger } from '../utils/logger.js';
import type { UnitOfWork } from '../storage/repos.js';
import { isPrivileged } from '../auth/access.js';

export function createBot(opts: {
  token: string;
  registry: CommandRegistry;
  uow: UnitOfWork;
  logger: Logger;
}): Telegraf {
  const bot = new Telegraf(opts.token);

  // --- Basic text handling (so DM doesn't feel "dead") ---
  // If user types a simple greeting like "سلام" in PM, respond.
  bot.hears(/^(سلام|hi|hello)$/i, async (ctx) => {
    // Keep it short and safe for groups too.
    await ctx.reply('سلام 👋\nبرای لیست دستورها: /help');
  });

  // In private chats, reply to any non-command text with a tiny hint.
  bot.on('text', async (ctx, next) => {
    const chatType = ctx.chat?.type;
    const text = ctx.message?.text ?? '';
    const isCommand = text.trim().startsWith('/');

    if (chatType === 'private' && !isCommand) {
      await ctx.reply('برای شروع: /help\nیا تو گروه بزن: /ping');
      return;
    }
    return next();
  });

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
