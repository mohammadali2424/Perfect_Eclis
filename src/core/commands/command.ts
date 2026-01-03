import type { Context } from "telegraf";
import type { Logger } from "../utils/logger.js";
import type { AuditLog } from "../audit/auditLog.js";
import type { UnitOfWork } from "../storage/repos.js";

export type CommandDeps = {
  uow: UnitOfWork;
  logger: Logger;
  auditLog?: AuditLog;
};

export type CommandHandler = (ctx: Context, deps: CommandDeps) => Promise<void>;

export interface CommandDef {
  name: string; // primary name, e.g. 'xp'
  aliases?: string[]; // Persian aliases
  description: string;
  handler: CommandHandler;
}

export interface CommandRegistry {
  register(cmd: CommandDef): void;
  get(name: string): CommandDef | null;
  list(): CommandDef[];
}

export function createRegistry(): CommandRegistry {
  const map = new Map<string, CommandDef>();
  const add = (k: string, v: CommandDef) => map.set(k.toLowerCase(), v);

  return {
    register(cmd) {
      add(cmd.name, cmd);
      for (const a of cmd.aliases ?? []) add(a, cmd);
    },
    get(name) {
      return map.get(name.toLowerCase()) ?? null;
    },
    list() {
      const uniq = new Map<string, CommandDef>();
      for (const v of map.values()) uniq.set(v.name, v);
      return Array.from(uniq.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}
