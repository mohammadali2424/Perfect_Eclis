import { Telegraf } from 'telegraf';
import { createCommandRouter } from './commandRouter.js';
export function createBot(opts) {
    const bot = new Telegraf(opts.token);
    // Router (بدون اسلش)
    bot.use(createCommandRouter({
        registry: opts.registry,
        uowFactory: opts.uowFactory,
        logger: opts.logger
    }));
    return bot;
}
