import type { CommandDef } from "../../core/commands/command.js";
import { authority } from "../../core/authority/singleton.js";
import { RULE_NAZER_OR_OWNER } from "../../core/authority/rules.js";

function actorContext(ctx: any) {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId) return null;
  return { userId: Number(userId), chatId };
}

function ensureGroupChat(ctx: any): boolean {
  const t = ctx.chat?.type;
  return t && t !== "private";
}

export function registerChatSettingsCommands(registry: any) {
  const commands: CommandDef[] = [
    {
      name: "ثبت گروه مدیریت رول",
      description: "گروه فعلی را به عنوان گروه مدیریت رول ثبت می‌کند",
      handler: async (ctx, deps) => {
        const actx = actorContext(ctx);
        if (!actx || !actx.chatId) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

        if (!ensureGroupChat(ctx)) {
          await ctx.reply("این دستور فقط داخل گروه/سوپرگروه قابل اجراست.");
          return;
        }

        const uow = deps.uow as any;
        await uow.chatSettings.set("ROLE_MGMT_CHAT_ID", actx.chatId);
        if (typeof uow.commit === "function") await uow.commit();

await (deps as any).auditLog?.emit?.({
  level: "info",
  topic: "settings",
  action: "ROLE_MGMT_CHAT_SET",
  actorId: actx.userId,
  chatId: actx.chatId ?? null,
  message: "Role management chat set",
  meta: { roleMgmtChatId: actx.chatId },
});


        await ctx.reply("ثبت شد: این گروه به عنوان گروه مدیریت رول تنظیم شد.");
      },
    },
    {
      name: "حذف گروه مدیریت رول",
      description: "گروه مدیریت رول را حذف می‌کند",
      handler: async (ctx, deps) => {
        const actx = actorContext(ctx);
        if (!actx) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

        const uow = deps.uow as any;
        await uow.chatSettings.set("ROLE_MGMT_CHAT_ID", null);
        if (typeof uow.commit === "function") await uow.commit();

await deps.auditLog?.emit?.({
  level: "warn",
  topic: "settings",
  action: "ROLE_MGMT_CHAT_CLEAR",
  actorId: actx.userId,
  chatId: actx.chatId ?? null,
  message: "Role management chat cleared",
});


        await ctx.reply("حذف شد: گروه مدیریت رول پاک شد.");
      },
    },
    {
      name: "ثبت گروه لاگ",
      description: "گروه فعلی را به عنوان گروه لاگ ثبت می‌کند",
      handler: async (ctx, deps) => {
        const actx = actorContext(ctx);
        if (!actx || !actx.chatId) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

        if (!ensureGroupChat(ctx)) {
          await ctx.reply("این دستور فقط داخل گروه/سوپرگروه قابل اجراست.");
          return;
        }

        const uow = deps.uow as any;
        await uow.chatSettings.set("LOG_CHAT_ID", actx.chatId);
        if (typeof uow.commit === "function") await uow.commit();

await (deps as any).auditLog?.emit?.({
  level: "info",
  topic: "settings",
  action: "LOG_CHAT_SET",
  actorId: actx.userId,
  chatId: actx.chatId ?? null,
  message: "Log chat set",
  meta: { logChatId: actx.chatId },
});

        await ctx.reply("ثبت شد: این گروه به عنوان گروه لاگ تنظیم شد.");
      },
    },
    {
      name: "حذف گروه لاگ",
      description: "گروه لاگ را حذف می‌کند",
      handler: async (ctx, deps) => {
        const actx = actorContext(ctx);
        if (!actx) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

        const uow = deps.uow as any;
        await uow.chatSettings.set("LOG_CHAT_ID", null);
        if (typeof uow.commit === "function") await uow.commit();

await deps.auditLog?.emit?.({
  level: "warn",
  topic: "settings",
  action: "LOG_CHAT_CLEAR",
  actorId: actx.userId,
  chatId: actx.chatId ?? null,
  message: "Log chat cleared",
});


        await ctx.reply("حذف شد: گروه لاگ پاک شد.");
      },
    },
    {
      name: "تنظیمات چت",
      description: "نمایش تنظیمات ثبت‌شده",
      handler: async (ctx, deps) => {
        const actx = actorContext(ctx);
        if (!actx) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

        const uow = deps.uow as any;
        const s = await uow.chatSettings.getSnapshot();

        await ctx.reply(
          [
            "تنظیمات:",
            `گروه مدیریت رول: ${s.roleMgmtChatId ?? "(unset)"}`,
            `گروه لاگ: ${s.logChatId ?? "(unset)"}`,
          ].join("\n")
        );
      },
    },
  ];

  for (const c of commands) registry.register(c);
}
