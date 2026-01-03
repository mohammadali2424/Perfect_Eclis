export type AuditLevel = "info" | "warn" | "error";

export interface AuditEvent {
  level: AuditLevel;
  topic: string;           // e.g. "admin", "settings"
  action: string;          // e.g. "ADMIN_ADD", "LOG_CHAT_SET"
  actorId?: number;        // telegram user id
  targetId?: number;       // telegram user id
  chatId?: number | null;  // chat where action happened
  message: string;         // human readable
  meta?: Record<string, any>;
  ts?: string;
}

export interface AuditLog {
  emit(event: AuditEvent): Promise<void>;
}

export class NullAuditLog implements AuditLog {
  async emit(_: AuditEvent): Promise<void> {}
}
