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

  // Anti-abuse: if bot is added by non-owner, warn and leave
  const ownerId = Number(process.env.OWNER_TELEGRAM_ID || "0");

  bot.on("my_chat_member", async (ctx) => {
    try {
      const addedBy = ctx.from?.id ? Number(ctx.from.id) : null;

      // New status of the bot in the chat
      const newStatus = (ctx.myChatMember as any)?.new_chat_member?.status;

      // Trigger only when bot becomes a member/admin
      const becameMember = newStatus === "member" || newStatus === "administrator";

      if (!becameMember) return;

      // If we cannot determine who added it, treat as not authorized (per your request)
      const isOwner = addedBy !== null && ownerId > 0 && addedBy === ownerId;

      if (!isOwner) {
        await ctx.reply("دست نزن چخه");
        // small delay to ensure message is delivered before leaving
        await new Promise((r) => setTimeout(r, 400));
        await ctx.leaveChat();
      }
    } catch {
      // if anything fails, attempt to leave to be safe
      try {
        await ctx.leaveChat();
      } catch {
        // ignore
      }
    }
  });


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
