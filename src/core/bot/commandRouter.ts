import type { MiddlewareFn } from "telegraf";
import type { Context } from "telegraf";
import type { UnitOfWork } from "../storage/repos.js";
import type { CommandRegistry } from "../commands/registry.js";
import type { Logger } from "../utils/logger.js";
import type { AuditLog } from "../audit/auditLog.js";
import { NullAuditLog } from "../audit/auditLog.js";

type RouterCtx = Context & { uow: UnitOfWork };

function isTextMessage(ctx: Context): ctx is Context & { message: { text: string } } {
  return Boolean((ctx as any).message?.text);
}

export function createCommandRouter(opts: {
  registry: CommandRegistry;
  uowFactory: () => UnitOfWork;
  logger: Logger;
  auditLog?: AuditLog;
}): MiddlewareFn<Context> {
  const { registry, uowFactory, logger } = opts;
  const auditLog: AuditLog = opts.auditLog ?? new NullAuditLog();

  return async (ctx, next) => {
    if (!isTextMessage(ctx)) return next();

    const text = ctx.message.text.trim();
    if (!text) return next();

    const normalizedFull = text.replace(/^\/+/, "").toLowerCase();
    const [headRaw] = normalizedFull.split(/\s+/);
    const head = headRaw ?? "";

    const def = registry.get(normalizedFull) ?? registry.get(head);
    if (!def) return next();

    (ctx as RouterCtx).uow = uowFactory();

    try {
      await def.handler(ctx as RouterCtx, {
        uow: (ctx as RouterCtx).uow,
        logger,
        auditLog,
      });
    } catch (err) {
      logger.error("command handler failed", { cmd: normalizedFull, err });

      // ثبت خطا در لاگ تلگرام هم (اگر تنظیم شده باشد)
      try {
        const actorId = (ctx as any).from?.id ? Number((ctx as any).from.id) : undefined;
        const chatId = (ctx as any).chat?.id ? Number((ctx as any).chat.id) : undefined;

        await auditLog.emit({
          level: "error",
          topic: "router",
          action: "COMMAND_FAIL",
          actorId,
          chatId,
          message: "command handler failed",
          meta: { cmd: normalizedFull },
        });
      } catch {
        // ignore
      }

      await ctx.reply("خطای داخلی در اجرای دستور.");
    }
  };
}
