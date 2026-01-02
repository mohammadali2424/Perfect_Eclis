function isTextMessage(ctx) {
    return Boolean(ctx.message?.text);
}
export function createCommandRouter(opts) {
    const { registry, uowFactory, logger } = opts;
    return async (ctx, next) => {
        if (!isTextMessage(ctx))
            return next();
        const text = ctx.message.text.trim();
        if (!text)
            return next();
        // فرمان‌ها بدون اسلش هستند، اما برای دیباگ می‌توان /... هم نوشت.
        // 1) ابتدا کل متن را به‌عنوان کلید فرمان امتحان می‌کنیم (برای فرمان‌های چندکلمه‌ای)
        // 2) اگر پیدا نشد، اولین توکن (head) را امتحان می‌کنیم.
        const normalizedFull = text.replace(/^\/+/, "").toLowerCase();
        const [headRaw] = normalizedFull.split(/\s+/);
        const head = headRaw ?? "";
        const def = registry.get(normalizedFull) ?? registry.get(head);
        if (!def)
            return next();
        // attach uow
        ctx.uow = uowFactory();
        try {
            await def.handler(ctx, { uow: ctx.uow, logger });
        }
        catch (err) {
            logger.error('command handler failed', { cmd: normalizedFull, err });
            await ctx.reply('خطای داخلی در اجرای دستور.');
        }
    };
}
