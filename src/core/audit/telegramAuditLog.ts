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

function hashtags(tags: string[]): string {
  const uniq = Array.from(new Set(tags.map(t => String(t).trim()).filter(Boolean)));
  return uniq.length ? uniq.map(t => `#${t}`).join(" ") : "";
}

function buildLocation(ev: any): string {
  const parts: string[] = [];
  if (ev?.region) parts.push(`ریجن: ${ev.region}`);
  if (ev?.spot) parts.push(`اسپات: ${ev.spot}`);
  if (ev?.zone) parts.push(`زون: ${ev.zone}`);
  return parts.length ? parts.join(" — ") : "";
}

function actorText(ev: any): string {
  const m = ev?.meta || {};
  const id = typeof m.actorTelegramId === "number" ? m.actorTelegramId : null;

  const label =
    m.actorUsername ? `@${m.actorUsername}` :
    m.actorName ? String(m.actorName) :
    ev?.actorLabel ? String(ev.actorLabel) :
    id != null ? String(id) : "؟";

  return id != null ? mention(id, label) : escapeHtml(label);
}

function targetText(ev: any): string {
  const m = ev?.meta || {};
  const id = typeof m.targetTelegramId === "number" ? m.targetTelegramId : null;

  const label =
    m.targetUsername ? `@${m.targetUsername}` :
    m.targetName ? String(m.targetName) :
    ev?.targetLabel ? String(ev.targetLabel) :
    id != null ? String(id) : "";

  if (!label) return "";
  return id != null ? mention(id, label) : escapeHtml(label);
}

function formatGenericEvent(e: AuditEvent): string {
  const ts = escapeHtml(e.ts || new Date().toISOString());
  const lvl = escapeHtml(String(e.level).toUpperCase());
  const topic = escapeHtml(e.topic);
  const action = escapeHtml(e.action);

  const actor = e.actorId ? mention(e.actorId, "actor") : "actor:?";
  const target = e.targetId ? mention(e.targetId, "target") : "";
  const chat = e.chatId != null ? `چت: ${escapeHtml(String(e.chatId))}` : "";

  const header = `<b>[${lvl}]</b> <b>${topic}</b> <i>${action}</i>`;
  const body = e.message ? escapeHtml(e.message) : "";

  const lines = [
    header,
    `زمان: ${ts}`,
    chat,
    `${actor}${target ? " → " + target : ""}`,
    body,
  ].filter(Boolean);

  // meta فقط برای error (یا اگر خواستی بعداً تنظیمش کنیم)
  const showMeta = e.level === "error";
  const meta = showMeta && e.meta ? `<code>${escapeHtml(JSON.stringify(e.meta))}</code>` : "";

  return meta ? `${lines.join("\n")}\n${meta}` : lines.join("\n");
}

function formatWorldT1(e: AuditEvent): string {
  const ev = (e.meta as any)?.event;

  const title = ev?.title ? escapeHtml(String(ev.title)) : "رخداد مهم جهان";
  const summary = ev?.summary ? escapeHtml(String(ev.summary)) : "";

  const tags = Array.isArray(ev?.tags) ? ev.tags : [];
  const tagLine = hashtags(tags.map(String));

  const loc = buildLocation(ev);
  const actor = actorText(ev);
  const target = targetText(ev);

  const lines = [
    tagLine ? `<b>${escapeHtml(tagLine)} — ${title}</b>` : `<b>${title}</b>`,
    summary ? `خلاصه: ${summary}` : "",
    loc ? `مکان: ${escapeHtml(loc)}` : "",
    `عامل: ${actor}`,
    target ? `هدف: ${target}` : "",
  ].filter(Boolean);

  // meta فقط برای error
  const showMeta = e.level === "error";
  const meta = showMeta && e.meta ? `<code>${escapeHtml(JSON.stringify(e.meta))}</code>` : "";

  return meta ? `${lines.join("\n")}\n${meta}` : lines.join("\n");
}

export class TelegramAuditLog implements AuditLog {
  constructor(
    private telegram: any,
    private getLogChatId: () => Promise<number | null>
  ) {}

  async emit(event: AuditEvent): Promise<void> {
const debug = `<code>${escapeHtml(JSON.stringify({ topic: event.topic, action: event.action }))}</code>`;
    const chatId = await this.getLogChatId();
    if (!chatId) return;

    const isWorldT1 = event.topic === "world" && event.action === "WORLD_T1";
    const text = isWorldT1 ? formatWorldT1(event) : formatGenericEvent(event);

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
