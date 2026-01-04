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

function buildLocation(ev: any): string {
  const parts: string[] = [];
  if (ev?.region) parts.push(`ریجن: ${ev.region}`);
  if (ev?.spot) parts.push(`اسپات: ${ev.spot}`);
  if (ev?.zone) parts.push(`زون: ${ev.zone}`);
  return parts.length ? parts.join(" — ") : "";
}

function actorTextFromWorldEvent(ev: any): string {
  const m = ev?.meta || {};
  // اگر از emitter داده شود
  const id =
    typeof m.actorTelegramId === "number"
      ? m.actorTelegramId
      : typeof m.by === "number"
        ? m.by
        : null;

  const label =
    m.actorUsername ? `@${m.actorUsername}` :
    m.actorName ? String(m.actorName) :
    ev?.actorLabel ? String(ev.actorLabel) :
    id != null ? String(id) : "نامشخص";

  return id != null ? mention(id, label) : escapeHtml(label);
}

function targetTextFromWorldEvent(ev: any): string {
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

// قالب عمومی (برای بقیه‌ی رویدادها)
function formatGeneric(e: AuditEvent): string {
  const ts = e.ts || new Date().toISOString();
  const lvl = String(e.level).toUpperCase();

  const chatLine =
    e.chatId != null ? `گروه/چت: ${escapeHtml(String(e.chatId))}` : `گروه/چت: نامشخص`;

  const actorLine =
    e.actorId != null ? `Actor: ${mention(e.actorId, "Actor")}` : `Actor: نامشخص`;

  const header = `<b>[${escapeHtml(lvl)}]</b> <b>${escapeHtml(e.topic)}</b> — <i>${escapeHtml(e.action)}</i>`;
  const body = e.message ? `پیام: ${escapeHtml(e.message)}` : `پیام:`;

  // meta فقط برای error یا وقتی پیام خالی است
  const showMeta = e.level === "error" || !e.message;
  const meta = showMeta && e.meta ? `<code>${escapeHtml(JSON.stringify(e.meta))}</code>` : "";

  const out = [header, escapeHtml(ts), chatLine, actorLine, body].join("\n");
  return meta ? `${out}\n${meta}` : out;
}

// قالب نهایی WorldEvent (T1)
function formatWorldT1(e: AuditEvent): string {
  const ev = (e.meta as any)?.event;

  const tags = Array.isArray(ev?.tags) ? ev.tags.map(String) : [];
  const tagLine = hashtags(tags);

  const title = ev?.title ? escapeHtml(String(ev.title)) : "رخداد مهم جهان";
  const summary = ev?.summary ? escapeHtml(String(ev.summary)) : "";

  const loc = buildLocation(ev);
  const actor = actorTextFromWorldEvent(ev);
  const target = targetTextFromWorldEvent(ev);

  // تیتر: هشتگ‌ها + عنوان
  const head = tagLine ? `<b>${escapeHtml(tagLine)} — ${title}</b>` : `<b>${title}</b>`;

  const lines = [
    head,
    summary ? `خلاصه: ${summary}` : "",
    loc ? `مکان: ${escapeHtml(loc)}` : "",
    `عامل: ${actor}`,
    target ? `هدف: ${target}` : "",
  ].filter(Boolean);

  // meta فقط برای error
  const showMeta = e.level === "error";
  const meta = showMeta && e.meta ? `<code>${escapeHtml(JSON.stringify(e.meta))}</code>` : "";

  const out = lines.join("\n");
  return meta ? `${out}\n${meta}` : out;
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
