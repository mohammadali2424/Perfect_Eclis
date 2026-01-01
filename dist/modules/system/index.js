export function registerSystemModule(registry) {
    registry.register({
        name: 'ping',
        aliases: ['پینگ'],
        description: 'تست اتصال ربات',
        handler: async (ctx) => {
            await ctx.reply('pong ✅');
        }
    });
    registry.register({
        name: 'start',
        aliases: ['شروع'],
        description: 'پیام شروع/خوش‌آمد',
        handler: async (ctx) => {
            await ctx.reply('سلام! 👋\nبرای دیدن دستورها: /help');
        }
    });
}
