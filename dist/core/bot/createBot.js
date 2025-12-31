import { Telegraf } from 'telegraf';
import { createCommandRouter } from './commandRouter.js';
export function createBot(opts) {
    const bot = new Telegraf(opts.token);
    // Minimal: ensure we have player record on any incoming message
    bot.use(async (ctx, next) => {
        if (ctx.from) {
            await opts.uow.players.getOrCreateFromTelegram(ctx.from);
        }
        return next();
    });
    bot.use(createCommandRouter(opts.registry, opts.uow, opts.logger));
    bot.catch((err, ctx) => {
        opts.logger.error('Bot error', { err: String(err), update: ctx.updateType });
    });
    return bot;
}
