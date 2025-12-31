function parseDelta(s) {
    if (!s)
        return null;
    const n = Number(s);
    if (!Number.isFinite(n))
        return null;
    if (n === 0)
        return 0;
    // allow +10 or -5
    return n;
}
export function makeXpCommand(xp) {
    return {
        name: 'ایکسپی',
        aliases: ['xp'],
        description: 'ثبت/نمایش XP. مثال: !ایکسپی +10 شکار گرگ | !ایکسپی نمایش',
        async execute(ctx) {
            const [first, ...rest] = ctx.args;
            if (!first || first === 'نمایش' || first === 'show') {
                const total = xp.sum(ctx.chatId, ctx.userId);
                return `📈 XP شما در این گروه: ${total}`;
            }
            const delta = parseDelta(first);
            if (delta === null)
                return 'فرمت اشتباه. مثال: !ایکسپی +10 شکار گرگ';
            const reason = rest.join(' ').trim() || 'بدون دلیل';
            xp.add(ctx.chatId, ctx.userId, delta, reason);
            const total = xp.sum(ctx.chatId, ctx.userId);
            const sign = delta >= 0 ? '+' : '';
            return `✅ ثبت شد: ${sign}${delta} XP — ${reason}\n📌 مجموع: ${total}`;
        }
    };
}
