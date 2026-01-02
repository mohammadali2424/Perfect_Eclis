import type { CommandDef } from "../../core/commands/command.js";
import { authority } from "../../main.js";
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

        await deps.uow.chatSettings.set("ROLE_MGMT_CHAT_ID", actx.chatId);
        await deps.uow.commit?.();
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

        await deps.uow.chatSettings.set("ROLE_MGMT_CHAT_ID", null);
        await deps.uow.commit?.();
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

        await deps.uow.chatSettings.set("LOG_CHAT_ID", actx.chatId);
        await deps.uow.commit?.();
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

        await deps.uow.chatSettings.set("LOG_CHAT_ID", null);
        await deps.uow.commit?.();
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

        const s = await deps.uow.chatSettings.getSnapshot();
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
