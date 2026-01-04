import type { AuditEvent, AuditLog } from "../../core/audit/auditLog.js";

function escapeHtml(s: string): string {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function mention(userId: number, label?: string): string {
  const safe = escapeHtml(label?.trim() || String(userId));
  return `<a href="tg://user?id=${userId}">${safe}</a>`;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function hashtags(tags: string[]): string {
  const clean = uniq(tags.map(t => String(t).trim()).filter(Boolean));
  return clean.length ? clean.map(t => `#${t}`).join(" ") : "";
}

function formatGeneric(event: AuditEvent): string {
  const ts = escapeHtml(event.ts || new Date().toISOString());
  const lvl = escapeHtml(String(event.level).toUpperCase());
  const topic = escapeHtml(event.topic);
  const action = escapeHtml(event.action);

  const chatTitle = (event.meta as any)?.chatTitle ? String((event.meta as any).chatTitle) : "";
  const chatId = event.chatId != null ? String(event.chatId) : "";
  const chatLine =
    chatTitle && chatId
      ? `گروه/چت: ${escapeHtml(chatTitle)} (${escapeHtml(chatId)})`
      : chatId
        ? `گروه/چت: ${escapeHtml(chatId)}`
        : `گروه/چت: نامشخص`;

  const actorLine = event.actorId ? `Actor: ${mention(event.actorId, "Actor")}` : `Actor: نامشخص`;

  const header = `<b>[${lvl}]</b> <b>${topic}</b> — <i>${action}</i>`;
  const msg = event.message ? `پیام: ${escapeHtml(event.message)}` : `پیام:`;

  const showMeta = event.level === "error" || !event.message;
  const meta = showMeta && event.meta ? `<code>${escapeHtml(JSON.stringify(event.meta))}</code>` : "";

  const base = [header, ts, chatLine, actorLine, msg].join("\n");
  return meta ? `${base}\n${meta}` : base;
}

function formatWorldT1(event: AuditEvent): string {
  const ev = (event.meta as any)?.event;

  const tags: string[] = Array.isArray(ev?.tags) ? ev.tags.map((t: string) => String(t)) : [];
  const tagLine = hashtags(tags);

  const title = ev?.title ? escapeHtml(String(ev.title)) : "رویداد مهم جهان";
  const summary = ev?.summary ? escapeHtml(String(ev.summary)) : "";

  const locParts: string[] = [];
  if (ev?.region) locParts.push(`ریجن: ${escapeHtml(String(ev.region))}`);
  if (ev?.spot) locParts.push(`اسپات: ${escapeHtml(String(ev.spot))}`);
  if (ev?.zone) locParts.push(`زون: ${escapeHtml(String(ev.zone))}`);
  const location = locParts.length ? locParts.join(" › ") : "نامشخص";

  const meta = ev?.meta || {};
  const actorId =
    typeof meta.actorTelegramId === "number"
      ? meta.actorTelegramId
      : typeof meta.by === "number"
        ? meta.by
        : null;

  const actorLabel =
    meta.actorUsername ? `@${meta.actorUsername}` :
    meta.actorName ? String(meta.actorName) :
    ev?.actorLabel ? String(ev.actorLabel) :
    actorId != null ? String(actorId) : "نامشخص";

  const actor = actorId != null ? mention(actorId, actorLabel) : escapeHtml(actorLabel);

  const targetId = typeof meta.targetTelegramId === "number" ? meta.targetTelegramId : null;
  const targetLabel =
    meta.targetUsername ? `@${meta.targetUsername}` :
    meta.targetName ? String(meta.targetName) :
    ev?.targetLabel ? String(ev.targetLabel) :
    targetId != null ? String(targetId) : "";

  const target = targetLabel
    ? (targetId != null ? mention(targetId, targetLabel) : escapeHtml(targetLabel))
    : "";

  // قالب مرتب + ایموجی + زیر هم
  const lines = [
    "🧾 ECLIS_LOG_v1",
    "🌌 رویداد مهم جهان",
    "",
    `🏷️ ${tagLine || "—"}`,
    `🧩 عنوان: ${title}`,
    summary ? `📝 توضیح: ${summary}` : "",
    `📍 مکان: ${location}`,
    `👤 عامل: ${actor}`,
    target ? `🎯 هدف: ${target}` : "",
  ].filter(Boolean);

  // meta فقط برای error
  const showMeta = event.level === "error";
  const extra = showMeta && event.meta ? `\n<code>${escapeHtml(JSON.stringify(event.meta))}</code>` : "";

  return lines.join("\n") + extra;
}

export class TelegramAuditLog implements AuditLog {
  constructor(
    private telegram: any,
    private getLogChatId: () => Promise<number | null>
  ) {}

  async emit(event: AuditEvent): Promise<void> {
    const chatId = await this.getLogChatId();
    if (!chatId) return;

    const isWorldT1 = event.topic === "world" && event.action === "WORLD_T1";
    const text = isWorldT1 ? formatWorldT1(event) : formatGeneric(event);

    try {
      await this.telegram.sendMessage(chatId, text, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    } catch {
      // ignore
    }
  }
}
