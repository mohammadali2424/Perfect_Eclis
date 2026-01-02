import type { CommandRegistry } from '../../core/commands/registry.js';

export function registerHelpModule(registry: CommandRegistry) {
  registry.register({
    name: 'help',
    aliases: ['راهنما', 'helpme'],
    description: 'نمایش فهرست دستورها',
    handler: async (ctx, { logger }) => {
      const lines = registry.list().map((c) => `/${c.name} — ${c.description}`);
      await ctx.reply([...lines, '', 'نمونه: /xp add @username 20 تمرین خوب'].join('\n'));
      logger.debug('help shown');
    }
  });
}
