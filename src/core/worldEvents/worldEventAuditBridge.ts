import type { AuditLog } from "../audit/auditLog.js";
import type { WorldEvent } from "./worldEvent.js";

export function worldEventToAudit(e: WorldEvent) {
  return {
    level: "warn" as const,
    topic: "world",
    action: "WORLD_T1",
    message: "", // فرمت‌دهی در TelegramAuditLog انجام می‌شود
    meta: { event: e },
  };
}

export function attachWorldEventAuditBridge(
  bus: { on: (h: (e: WorldEvent) => any) => void },
  auditLog: AuditLog
) {
  bus.on(async (e: WorldEvent) => {
    if (e.tier !== "T1") return;
    await auditLog.emit(worldEventToAudit(e));
  });
}
