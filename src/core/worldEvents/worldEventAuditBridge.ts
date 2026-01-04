import type { AuditLog } from "../audit/auditLog.js";
import type { WorldEvent } from "./worldEvent.js";

function hashtags(tags: string[]): string {
  return tags.map(t => `#${t}`).join(" ");
}

export function worldEventToAudit(e: WorldEvent) {
  const head = `${hashtags(e.tags)} — ${e.title}`;
  const locParts = [e.region, e.spot, e.zone].filter(Boolean);
  const loc = locParts.length ? `مکان: ${locParts.join(" / ")}` : "";

  const actors =
    e.actorLabel || e.targetLabel
      ? `عامل: ${e.actorLabel ?? "؟"}${e.targetLabel ? ` → هدف: ${e.targetLabel}` : ""}`
      : "";

  const lines = [head, loc, actors, `خلاصه: ${e.summary}`].filter(Boolean).join("\n");

  return {
    level: "warn" as const,
    topic: "world",
    action: "WORLD_T1",
    message: lines,
    meta: e.meta,
  };
}

export function attachWorldEventAuditBridge(bus: { on: any }, auditLog: AuditLog) {
  bus.on(async (e: WorldEvent) => {
    if (e.tier !== "T1") return;
    await auditLog.emit(worldEventToAudit(e));
  });
}
