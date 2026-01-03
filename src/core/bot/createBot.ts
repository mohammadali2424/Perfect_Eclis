import { Telegraf } from "telegraf";

import type { CommandRegistry } from "../commands/registry.js";
import type { Logger } from "../utils/logger.js";
import type { UnitOfWork } from "../storage/repos.js";
import { createCommandRouter } from "./commandRouter.js";
import type { AuditLog } from "../audit/auditLog.js";

export function createBot(opts: {
  token: string;
  registry: CommandRegistry;
  uowFactory: () => UnitOfWork;
  logger: Logger;
  buildAuditLog?: (telegram: any, uowFactory: () => UnitOfWork) => AuditLog;
}) {
  const bot = new Telegraf(opts.token);

  const auditLog = opts.buildAuditLog
    ? opts.buildAuditLog(bot.telegram, opts.uowFactory)
    : undefined;

  bot.use(
    createCommandRouter({
      registry: opts.registry,
      uowFactory: opts.uowFactory,
      logger: opts.logger,
      auditLog,
    })
  );

  return bot;
}
