function extractCommand(text) {
    const m = text.trim().match(/^\/(\S+)(?:\s+(.*))?$/s);
    if (!m)
        return null;
    return { name: m[1].toLowerCase(), args: (m[2] ?? '').trim() };
}
export function createCommandRouter(opts) {
    return async (ctx, next) => {
        const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
        if (!text || !text.startsWith('/'))
            return next();
        const parsed = extractCommand(text);
        if (!parsed)
            return next();
        const cmd = opts.registry.get(parsed.name);
        if (!cmd)
            return next();
        // attach args for handlers
        ctx.argsText = parsed.args;
        try {
            await cmd.handler(ctx, { uow: opts.uow, logger: opts.logger });
        }
        catch (err) {
            opts.logger.error('Command failed', { cmd: parsed.name, err });
            await ctx.reply('❌ خطا در اجرای دستور. لاگ ثبت شد.');
        }
    };
}
