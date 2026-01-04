import type { AuditLog } from "../audit/auditLog.js";
import { WorldEventBus } from "./bus.js";
import { attachWorldEventAuditBridge } from "./worldEventAuditBridge.js";

export const worldEvents = new WorldEventBus();

let bridged = false;

/**
 * باید یکبار در main.ts بعد از ساخت auditLog صدا زده شود.
 */
export function initWorldEvents(auditLog: AuditLog) {
  if (bridged) return;
  attachWorldEventAuditBridge(worldEvents, auditLog);
  bridged = true;
}
