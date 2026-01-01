// Placeholder: next step is Role/Permission module with Persian commands.
export const adminPingCommand = {
    name: 'ادمین',
    aliases: ['admin'],
    description: 'تست دسترسی ادمین (فعلاً نمونه)',
    async execute(ctx) {
        return `سلام ادمین! (chat=${ctx.chatId}, user=${ctx.userId})`;
    }
};
