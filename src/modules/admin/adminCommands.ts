import type { CommandDef } from "../../core/commands/command.js";
import type { AuthorityContext } from "../../core/authority/types.js";
import { RULE_OWNER_ONLY, RULE_NAZER_OR_OWNER } from "../../core/authority/rules.js";
import { authority } from "../../core/authority/singleton.js";
import { ensureRoleManagementChat } from "../../core/chat-policy/roleManagementGate.js";
import { adminStore } from "./index.js";
import { worldEvents } from "../../core/worldEvents/singleton.js";


function actorContext(ctx: any): AuthorityContext | null {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId) return null;
  return { userId: Number(userId), chatId };
}


function replyTargetTelegramUser(ctx: any): any | null {
  const rep = ctx.message?.reply_to_message;
  return rep?.from ?? null;
}

function replyTargetTelegramId(ctx: any): number | null {
  const u = replyTargetTelegramUser(ctx);
  const id = u?.id;
  return id == null ? null : Number(id);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function humanLabelFromUser(u: any): string {
  if (!u) return "";
  if (u.username) return `@${u.username}`;
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return name || "";
}

function mentionById(userId: number, label?: string): string {
  const safe = (label && label.trim()) ? label.trim() : String(userId);
  return `<a href="tg://user?id=${userId}">${escapeHtml(safe)}</a>`;
}

/**
 * تلاش می‌کند برای userId یک label انسانی بسازد:
 * 1) اگر replyUser داده شده باشد: @username یا نام
 * 2) اگر داخل گروه هستیم: از getChatMember برای گرفتن username/نام
 * 3) fallback: منشن با عدد
 */
async function describeUserHtml(ctx: any, userId: number, replyUser?: any): Promise<string> {
  const fromReply = humanLabelFromUser(replyUser);
  if (fromReply) return mentionById(userId, fromReply);

  const chatId = ctx.chat?.id;
  if (chatId) {
    try {
      const m = await ctx.telegram.getChatMember(chatId, userId);
      const label = humanLabelFromUser(m?.user);
      if (label) return mentionById(userId, label);
    } catch {
      // ignore
    }
  }
  return mentionById(userId, String(userId));
}

async function listWithNamesHtml(ctx: any, roles: any[]): Promise<string[]> {
  const chatId = ctx.chat?.id;

  // اگر در چت هستیم، تلاش برای گرفتن نام‌ها
  if (chatId) {
    const settled = await Promise.allSettled(
      roles.map((r) => ctx.telegram.getChatMember(chatId, Number(r.userId)))
    );
    return roles.map((r, i) => {
      const chatPart = r.scope?.type === "CHAT" ? ` (chat ${r.scope.chatId})` : "";
      const res = settled[i];
      const label =
        res.status === "fulfilled" ? humanLabelFromUser(res.value?.user) : "";
      const who = mentionById(Number(r.userId), label || String(r.userId));
      return `• ${who} — ${escapeHtml(String(r.role))}${escapeHtml(chatPart)}`;
    });
  }

  // اگر PV بود، فقط منشن با عدد (ولی clickable)
  return roles.map((r) => {
    const chatPart = r.scope?.type === "CHAT" ? ` (chat ${r.scope.chatId})` : "";
    const who = mentionById(Number(r.userId), String(r.userId));
    return `• ${who} — ${escapeHtml(String(r.role))}${escapeHtml(chatPart)}`;
  });
}

export function registerAdminCommands(registry: any) {
  const commands: CommandDef[] = [
    {
      name: "پنل",
      description: "پنل مدیریتی",
      handler: async (ctx, deps) => {
        const actx = actorContext(ctx);
        if (!actx) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

        const roles = await adminStore.listAll();

        await ctx.reply(
          [
            "پنل مدیریتی",
            `Owner(env): ${process.env.OWNER_TELEGRAM_ID || "(unset)"}`,
            `Total Roles: ${roles.length}`,
            "",
            "دستورها:",
            "پنل",
            "افزودن ناظر (Reply)",
            "حذف ناظر (Reply)",
            "لیست ناظرها",
            "افزودن ادمین (Reply)",
            "حذف ادمین (Reply)",
            "لیست ادمین‌ها",
            "افزودن ناظر چت (Reply)",
            "حذف ناظر چت (Reply)",
            "افزودن ادمین چت (Reply)",
            "حذف ادمین چت (Reply)",
          ].join("\n")
        );
      },
    },

    // ---------- NAZER (GLOBAL) ----------
    {
      name: "افزودن ناظر",
      description: "افزودن ناظر کل (با Reply)",
      handler: async (ctx, deps) => {
        const actx = actorContext(ctx);
        if (!actx) return;

        const decision = await authority.check(actx, RULE_OWNER_ONLY);
        if (!decision.allow) return;

        const targetUser = replyTargetTelegramUser(ctx);
        const targetId = replyTargetTelegramId(ctx);
        if (!targetId) {
          await ctx.reply("روی پیام فرد Reply کن و بنویس: افزودن ناظر");
          return;
        }

        await adminStore.addRole({
          userId: targetId,
          role: "NAZER_GLOBAL",
          scope: { type: "GLOBAL" },
        });

await (deps as any).auditLog?.emit?.({
  level: "info",
  topic: "admin",
  action: "ADMIN_ADD",
  actorId: actx.userId,
  targetId,
  chatId: actx.chatId ?? null,
  message: "Admin added",
  meta: { role: "ADMIN_GLOBAL", scope: "GLOBAL" },
});


await deps.auditLog?.emit?.({
  level: "info",
  topic: "test",
  action: "AUDIT_TEST",
  actorId: actx.userId,
  chatId: actx.chatId ?? null,
  message: "Audit log test message",
});
await ctx.reply("تست لاگ ارسال شد (اگر گروه لاگ تنظیم باشد).");


        const who = await describeUserHtml(ctx, targetId, targetUser);
        await ctx.reply(`ثبت شد: ${who} ناظر کل شد.`, { parse_mode: "HTML" });
      },
    },
    {
      name: "حذف ناظر",
      description: "حذف تمام نقش‌های این کاربر (با Reply)",
      handler: async (ctx, deps) => {
        const actx = actorContext(ctx);
        if (!actx) return;

        const decision = await authority.check(actx, RULE_OWNER_ONLY);
        if (!decision.allow) return;

        const targetUser = replyTargetTelegramUser(ctx);
        const targetId = replyTargetTelegramId(ctx);
        if (!targetId) {
          await ctx.reply("روی پیام فرد Reply کن و بنویس: حذف ناظر");
          return;
        }

        await adminStore.removeAllRoles(targetId);

        const who = await describeUserHtml(ctx, targetId, targetUser);
        await ctx.reply(`انجام شد: نقش‌های ${who} پاک شد.`, { parse_mode: "HTML" });
      },
    },
    {
      name: "لیست ناظرها",
      description: "نمایش لیست ناظرها",
      handler: async (ctx, deps) => {
        const actx = actorContext(ctx);
        if (!actx) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

        const roles = (await adminStore.listAll()).filter((r: any) =>
          String(r.role).startsWith("NAZER")
        );

        if (!roles.length) {
          await ctx.reply("هیچ ناظری ثبت نشده.");
          return;
        }

        const lines = await listWithNamesHtml(ctx, roles);
        await ctx.reply(["ناظرها:", ...lines].join("\n"), { parse_mode: "HTML" });
      },
    },

{
  name: "تست رخداد",
  description: "ساخت رخداد مهم (فقط برای تست ژورنال)",
  handler: async (ctx, deps) => {
    const actx = actorContext(ctx);
    if (!actx) return;

    const decision = await authority.check(actx, RULE_OWNER_ONLY);
    if (!decision.allow) return;

    await worldEvents.emit({
      tier: "T1",
      tags: ["CITY", "CAPTURE", "WAR"],
      title: "تصرف شهر",
      summary: "شهر «نُورکَست» توسط فکشن «آهنین» تصرف شد.",
      region: "ریجن نمونه",
      spot: "شهر نورکست",
      zone: "دروازه جنوبی",
      actorLabel: "Faction: آهنین",
      targetLabel: "City: نورکست",
      meta: { city: "norkast", faction: "iron", by: actx.userId },
    });

    await ctx.reply("رخداد تست ارسال شد.");
  },
},


    // ---------- ADMIN (GLOBAL) ----------
    {
      name: "افزودن ادمین",
      description: "افزودن ادمین کل (با Reply)",
      handler: async (ctx, deps) => {
        const actx = actorContext(ctx);
        if (!actx) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

        const targetUser = replyTargetTelegramUser(ctx);
        const targetId = replyTargetTelegramId(ctx);
        if (!targetId) {
          await ctx.reply("روی پیام فرد Reply کن و بنویس: افزودن ادمین");
          return;
        }

        await adminStore.addRole({
          userId: targetId,
          role: "ADMIN_GLOBAL",
          scope: { type: "GLOBAL" },
        });

await (deps as any).auditLog?.emit?.({
  level: "info",
  topic: "admin",
  action: "ADMIN_ADD",
  actorId: actx.userId,
  targetId,
  chatId: actx.chatId ?? null,
  message: "Admin added",
  meta: { role: "ADMIN_GLOBAL", scope: "GLOBAL" },
});


        const who = await describeUserHtml(ctx, targetId, targetUser);
        await ctx.reply(`ثبت شد: ${who} ادمین کل شد.`, { parse_mode: "HTML" });
      },
    },
    {
      name: "حذف ادمین",
      description: "حذف تمام نقش‌های این کاربر (با Reply)",
      handler: async (ctx, deps) => {
        const actx = actorContext(ctx);
        if (!actx) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

        const targetUser = replyTargetTelegramUser(ctx);
        const targetId = replyTargetTelegramId(ctx);
        if (!targetId) {
          await ctx.reply("روی پیام فرد Reply کن و بنویس: حذف ادمین");
          return;
        }

        await adminStore.removeAllRoles(targetId);

        const who = await describeUserHtml(ctx, targetId, targetUser);
        await ctx.reply(`انجام شد: نقش‌های ${who} پاک شد.`, { parse_mode: "HTML" });
      },
    },
    {
      name: "لیست ادمین‌ها",
      description: "نمایش لیست ادمین‌ها",
      handler: async (ctx, deps)=> {
        const actx = actorContext(ctx);
        if (!actx) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

        const roles = (await adminStore.listAll()).filter((r: any) =>
          String(r.role).startsWith("ADMIN")
        );

        if (!roles.length) {
          await ctx.reply("هیچ ادمینی ثبت نشده.");
          return;
        }

        const lines = await listWithNamesHtml(ctx, roles);
        await ctx.reply(["ادمین‌ها:", ...lines].join("\n"), { parse_mode: "HTML" });
      },
    },

    // ---------- CHAT-SCOPED ----------
    {
      name: "افزودن ناظر چت",
      description: "افزودن ناظر برای همین چت (با Reply)",
      handler: async (ctx, deps)=> {
        const actx = actorContext(ctx);
        if (!actx || !actx.chatId) return;

        const decision = await authority.check(actx, RULE_OWNER_ONLY);
        if (!decision.allow) return;

        const targetUser = replyTargetTelegramUser(ctx);
        const targetId = replyTargetTelegramId(ctx);
        if (!targetId) {
          await ctx.reply("روی پیام فرد Reply کن و بنویس: افزودن ناظر چت");
          return;
        }

        await adminStore.addRole({
          userId: targetId,
          role: "NAZER_CHAT",
          scope: { type: "CHAT", chatId: actx.chatId },
        });

await (deps as any).auditLog?.emit?.({
  level: "info",
  topic: "admin",
  action: "ADMIN_ADD",
  actorId: actx.userId,
  targetId,
  chatId: actx.chatId ?? null,
  message: "Admin added",
  meta: { role: "ADMIN_GLOBAL", scope: "GLOBAL" },
});


        const who = await describeUserHtml(ctx, targetId, targetUser);
        await ctx.reply(`ثبت شد: ${who} ناظر این چت شد.`, { parse_mode: "HTML" });
      },
    },
    {
      name: "حذف ناظر چت",
      description: "حذف ناظر همین چت (با Reply)",
      handler: async (ctx, deps) => {
        const actx = actorContext(ctx);
        if (!actx || !actx.chatId) return;

        const decision = await authority.check(actx, RULE_OWNER_ONLY);
        if (!decision.allow) return;

        const targetUser = replyTargetTelegramUser(ctx);
        const targetId = replyTargetTelegramId(ctx);
        if (!targetId) {
          await ctx.reply("روی پیام فرد Reply کن و بنویس: حذف ناظر چت");
          return;
        }

        await adminStore.removeRole({
          userId: targetId,
          role: "NAZER_CHAT",
          scope: { type: "CHAT", chatId: actx.chatId },
        });

        const who = await describeUserHtml(ctx, targetId, targetUser);
        await ctx.reply(`حذف شد: ${who} دیگر ناظر این چت نیست.`, { parse_mode: "HTML" });
      },
    },
    {
      name: "افزودن ادمین چت",
      description: "افزودن ادمین برای همین چت (با Reply)",
      handler: async (ctx, deps) => {
        const actx = actorContext(ctx);
        if (!actx || !actx.chatId) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

        const targetUser = replyTargetTelegramUser(ctx);
        const targetId = replyTargetTelegramId(ctx);
        if (!targetId) {
          await ctx.reply("روی پیام فرد Reply کن و بنویس: افزودن ادمین چت");
          return;
        }

        await adminStore.addRole({
          userId: targetId,
          role: "ADMIN_CHAT",
          scope: { type: "CHAT", chatId: actx.chatId },
        });

await (deps as any).auditLog?.emit?.({
  level: "info",
  topic: "admin",
  action: "ADMIN_ADD",
  actorId: actx.userId,
  targetId,
  chatId: actx.chatId ?? null,
  message: "Admin added",
  meta: { role: "ADMIN_GLOBAL", scope: "GLOBAL" },
});


        const who = await describeUserHtml(ctx, targetId, targetUser);
        await ctx.reply(`ثبت شد: ${who} ادمین این چت شد.`, { parse_mode: "HTML" });
      },
    },

    {
      name: "حذف ادمین چت",
      description: "حذف ادمین همین چت (با Reply)",
      handler: async (ctx, deps)=> {
        const actx = actorContext(ctx);
        if (!actx || !actx.chatId) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

        const targetUser = replyTargetTelegramUser(ctx);
        const targetId = replyTargetTelegramId(ctx);
        if (!targetId) {
          await ctx.reply("روی پیام فرد Reply کن و بنویس: حذف ادمین چت");
          return;
        }

        await adminStore.removeRole({
          userId: targetId,
          role: "ADMIN_CHAT",
          scope: { type: "CHAT", chatId: actx.chatId },
        });

        const who = await describeUserHtml(ctx, targetId, targetUser);
        await ctx.reply(`حذف شد: ${who} دیگر ادمین این چت نیست.`, { parse_mode: "HTML" });
      },
    },
  ];


  for (const c of commands) registry.register(c);
}
