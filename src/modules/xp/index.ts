import type { CommandRegistry } from '../../core/commands/registry.js';
import type { Context } from 'telegraf';

function parseUserRef(token: string): { telegramId?: number; username?: string } {
  // Accept @username or numeric id
  const t = token.trim();
  if (/^@/.test(t)) return { username: t.slice(1) };
  const num = Number(t);
  if (Number.isFinite(num)) return { telegramId: num };
  return {};
}

async function resolveTarget(ctx: Context, args: string): Promise<{ id: number; label: string } | null> {
  // Priority: reply-to user
  const reply = (ctx.message as any)?.reply_to_message?.from;
  if (reply?.id) {
    const label = reply.username ? `@${reply.username}` : `${reply.first_name ?? ''} ${reply.last_name ?? ''}`.trim();
    return { id: reply.id, label: label || String(reply.id) };
  }

  const parts = args.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return null;
  const ref = parseUserRef(parts[0]);
  if (ref.telegramId) return { id: ref.telegramId, label: String(ref.telegramId) };
  // For now we can't resolve username to id without DB lookup or Telegram API. We'll require reply-to.
  if (ref.username) {
    await ctx.reply('برای هدف‌گیری با @username فعلاً باید روی پیام همان کاربر ریپلای کنی (یا آیدی عددی بدهی).');
  }
  return null;
}

export function registerXpModule(registry: CommandRegistry) {
  registry.register({
    name: 'xp',
    aliases: ['ایکس‌پی', 'اکسپ'],
    description: 'ثبت و گزارش XP (reply روی پیام پلیر هم قابل استفاده است)',
    handler: async (ctx, { uow, logger }) => {
      const text = (ctx.message as any)?.text as string | undefined;
      if (!text) return;
      const [, ...rest] = text.trim().split(/\s+/);
      const sub = (rest[0] ?? '').toLowerCase();
      const args = rest.slice(1).join(' ');

      const actor = (ctx.from && (await uow.players.getOrCreateFromTelegram(ctx.from))) ?? null;
      if (!actor) return;

      if (!sub || sub === 'help' || sub === 'راهنما') {
        await ctx.reply(
          [
            'دستورهای XP:',
            '• /xp add <amount> <reason>  (روی پیام پلیر ریپلای کن)',
            '• /xp give <amount> <reason> (alias)',
            '• /xp show  (XP خودت)',
            '• /xp show @id (نیاز به آیدی عددی یا ریپلای)',
            '• /xp report [chatId] (گزارش تجمیعی این چت)'
          ].join('\n')
        );
        return;
      }

      if (sub === 'show' || sub === 'نمایش') {
        const target = await resolveTarget(ctx, args);
        const playerId = target?.id ?? actor.id;
        const p = await uow.players.getById(playerId);
        if (!p) {
          await ctx.reply('پلیر پیدا نشد.');
          return;
        }
        await ctx.reply(`XP: ${p.xp}\nLevel: ${p.lvl}`);
        return;
      }

      if (sub === 'add' || sub === 'give' || sub === 'افزودن' || sub === 'دادن') {
        const parts = args.trim().split(/\s+/);
        const amount = Number(parts[0]);
        if (!Number.isFinite(amount) || amount === 0) {
          await ctx.reply('مقدار XP نامعتبر است. نمونه: /xp add 20 تمرین خوب');
          return;
        }
        const reason = parts.slice(1).join(' ').trim() || '—';
        const target = await resolveTarget(ctx, '');
        if (!target) {
          await ctx.reply('برای ثبت XP باید روی پیام پلیر ریپلای کنی (یا بعداً سیستم منشن را اضافه می‌کنیم).');
          return;
        }
        const before = await uow.players.getOrCreateFromTelegram({ id: target.id, first_name: target.label } as any);
        const entry = await uow.xp.add({
          actorId: actor.id,
          playerId: before.id,
          chatId: (ctx.chat?.id ?? 0) as any,
          amount,
          reason
        });
        const updated = await uow.players.getById(before.id);
        await ctx.reply(
          `ثبت شد ✅\nهدف: ${target.label}\nXP: ${amount > 0 ? '+' : ''}${amount}\nدلیل: ${reason}\nXP جدید: ${updated?.xp ?? '?'}\nEntry: ${entry.id}`
        );
        logger.info('xp add', { actor: actor.id, target: before.id, amount });
        return;
      }

      if (sub === 'report' || sub === 'گزارش') {
        const chatId = (ctx.chat?.id ?? 0) as any;
        const entries = await uow.xp.listByChat(chatId, 30);
        const sum = entries.reduce((a, e) => a + e.amount, 0);
        await ctx.reply(
          [`گزارش XP این چت (آخرین ${entries.length} رویداد):`, `جمع: ${sum}`, '', ...entries.map((e) => `• ${e.playerId}: ${e.amount > 0 ? '+' : ''}${e.amount} — ${e.reason}`)].join('\n')
        );
        return;
      }

      await ctx.reply('زیر‌دستور نامعتبر. /xp help');
    }
  });
}
