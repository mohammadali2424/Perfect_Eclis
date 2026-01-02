import type { Command } from '../../core/commands/types.js';
import type { CommandRegistry } from '../../core/commands/registry.js';

export function makeHelpCommand(registry: CommandRegistry): Command {
  return {
    name: 'راهنما',
    aliases: ['help', 'کمک'],
    description: 'لیست دستورهای ربات',
    async execute() {
      const cmds = registry.list();
      const lines = cmds
        .map(c => `• !${c.name}${c.aliases?.length ? ` (${c.aliases.join(', ')})` : ''} — ${c.description}`)
        .sort();
      return ['📌 دستورها:', ...lines].join('\n');
    }
  };
}
