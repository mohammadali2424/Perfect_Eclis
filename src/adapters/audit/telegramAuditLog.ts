import type { AuditEvent, AuditLog } from "../../core/audit/auditLog.js";

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function mention(userId: number, label?: string): string {
  const safe = escapeHtml(label?.trim() || String(userId));
  return `<a href="tg://user?id=${userId}">${safe}</a>`;
}

function formatEvent(e: AuditEvent): string {
  const ts = e.ts || new Date().toISOString();
  const lvl = e.level.toUpperCase();
  const who = e.actorId ? mention(e.actorId, "actor") : "actor:?";
  const tgt = e.targetId ? mention(e.targetId, "target") : "";
  const chat = e.chatId != null ? ` chat:${e.chatId}` : "";
  const meta = e.meta ? `<code>${escapeHtml(JSON.stringify(e.meta))}</code>` : "";

  const header = `<b>[${escapeHtml(lvl)}]</b> <b>${escapeHtml(e.topic)}</b> <i>${escapeHtml(e.action)}</i>`;
  const line = `${escapeHtml(ts)}\n${header}\n${who}${tgt ? " → " + tgt : ""}${escapeHtml(chat)}\n${escapeHtml(
    e.message
  )}`;

  return meta ? `${line}\n${meta}` : line;
}

export class TelegramAuditLog implements AuditLog {
  constructor(
    private telegram: any,
    private getLogChatId: () => Promise<number | null>
  ) {}

  async emit(event: AuditEvent): Promise<void> {
    const chatId = await this.getLogChatId();
    if (!chatId) return;

    try {
      await this.telegram.sendMessage(chatId, formatEvent(event), {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    } catch {
      // ignore
    }
  }
}
