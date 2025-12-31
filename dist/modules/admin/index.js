function isAdmin(roles) {
    return roles.includes('admin') || roles.includes('gm');
}
async function targetFromReply(ctx) {
    const reply = ctx.message?.reply_to_message?.from;
    if (!reply?.id)
        return null;
    const label = reply.username ? `@${reply.username}` : `${reply.first_name ?? ''} ${reply.last_name ?? ''}`.trim();
    return { id: reply.id, label: label || String(reply.id) };
}
export function registerAdminModule(registry) {
    registry.register({
        name: 'admin',
        aliases: ['مدیریت', 'ناظر'],
        description: 'ابزارهای مدیریت (نقش‌ها، ناظرها)',
        handler: async (ctx, { uow }) => {
            const text = ctx.message?.text;
            if (!text || !ctx.from)
                return;
            const actor = await uow.players.getOrCreateFromTelegram(ctx.from);
            if (!isAdmin(actor.roles)) {
                await ctx.reply('دسترسی نداری.');
                return;
            }
            const [, ...rest] = text.trim().split(/\s+/);
            const sub = (rest[0] ?? '').toLowerCase();
            const role = rest[2];
            if (!sub || sub === 'help' || sub === 'راهنما') {
                await ctx.reply([
                    'مدیریت:',
                    '• /admin role add <role> (reply روی پیام کاربر)',
                    '• /admin role remove <role> (reply)',
                    '• /admin me (نمایش نقش‌های من)'
                ].join('\n'));
                return;
            }
            if (sub === 'me' || sub === 'من') {
                await ctx.reply(`نقش‌های شما: ${actor.roles.join(', ') || '—'}`);
                return;
            }
            if (sub === 'role') {
                const action = rest[1];
                if (!action || !role) {
                    await ctx.reply('نمونه: /admin role add gm (reply)');
                    return;
                }
                const target = await targetFromReply(ctx);
                if (!target) {
                    await ctx.reply('باید روی پیام کاربر ریپلای کنی.');
                    return;
                }
                const p = await uow.players.getOrCreateFromTelegram({ id: target.id, first_name: target.label });
                const set = new Set(p.roles);
                if (action === 'add')
                    set.add(role);
                if (action === 'remove')
                    set.delete(role);
                const updated = await uow.players.update({ id: p.id, roles: [...set] });
                await ctx.reply(`انجام شد ✅\n${target.label}\nنقش‌ها: ${updated.roles.join(', ') || '—'}`);
                return;
            }
            await ctx.reply('دستور نامعتبر. /admin help');
        }
    });
}
