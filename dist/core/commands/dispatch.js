// Parses Telegram bot commands: /cmd arg1 arg2...
// Supports Persian aliases if registered.
export async function dispatchCommand(ctx, deps) {
    const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
    if (!text.startsWith('/'))
        return false;
    const [rawCmd] = text.split(/\s+/, 1);
    const cmdName = rawCmd.replace(/^\//, '').split('@')[0];
    const cmd = deps.registry.get(cmdName);
    if (!cmd)
        return false;
    await cmd.handler(ctx, { uow: deps.uow, logger: deps.logger });
    return true;
}
