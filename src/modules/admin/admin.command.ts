import type { Command } from '../../core/commands/types.js';

// Placeholder: next step is Role/Permission module with Persian commands.
export const adminPingCommand: Command = {
  name: 'ادمین',
  aliases: ['admin'],
  description: 'تست دسترسی ادمین (فعلاً نمونه)',
  async execute(ctx) {
    return `سلام ادمین! (chat=${ctx.chatId}, user=${ctx.userId})`;
  }
};
