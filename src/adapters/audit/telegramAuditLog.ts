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

function levelFa(level: string) {
  if (level === "info") return "اطلاعات";
  if (level === "warn") return "هشدار";
  if (level === "error") return "خطا";
  return level;
}

async function resolveChatLabel(telegram: any, chatId: number): Promise<string> {
  try {
    const chat = await telegram.getChat(chatId);
    const title = (chat && (chat.title || chat.username)) ? String(chat.title || `@${chat.username}`) : "";
    return title ? `${title} (${chatId})` : String(chatId);
  } catch {
    return String(chatId);
  }
}

function formatMeta(meta?: Record<string, any>): string {
  if (!meta) return "";
  try {
    return `<code>${escapeHtml(JSON.stringify(meta))}</code>`;
  } catch {
    return "";
  }
}

export class TelegramAuditLog implements AuditLog {
  constructor(
    private telegram: any,
    private getLogChatId: () => Promise<number | null>
  ) {}

  async emit(event: AuditEvent): Promise<void> {
    const logChatId = await this.getLogChatId();
    if (!logChatId) return;

    const ts = event.ts || new Date().toISOString();

    const actor = event.actorId ? mention(event.actorId, "Actor") : "Actor: نامشخص";
    const target = event.targetId ? mention(event.targetId, "Target") : "";

    const chatLine =
      event.chatId != null
        ? `گروه/چت: ${escapeHtml(await resolveChatLabel(this.telegram, Number(event.chatId)))}`
        : "گروه/چت: نامشخص";

    const header = `<b>[${escapeHtml(levelFa(event.level))}]</b> <b>${escapeHtml(event.topic)}</b> — <i>${escapeHtml(
      event.action
    )}</i>`;

    const body = [
      header,
      escapeHtml(ts),
      chatLine,
      `${actor}${target ? " → " + target : ""}`,
      `پیام: ${escapeHtml(event.message)}`,
    ].join("\n");

    const meta = formatMeta(event.meta);
    const text = meta ? `${body}\n${meta}` : body;

    try {
      await this.telegram.sendMessage(logChatId, text, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    } catch {
      // لاگ نباید سیستم را بخواباند
    }
  }
}
