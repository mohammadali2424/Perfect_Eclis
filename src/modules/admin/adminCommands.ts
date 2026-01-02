import type { CommandDef } from "../../core/commands/command.js";
import type { AuthorityContext } from "../../core/authority/types.js";
import { RULE_OWNER_ONLY, RULE_NAZER_OR_OWNER } from "../../core/authority/rules.js";
import { authority } from "../../core/authority/singleton.js";
import { adminStore } from "./index.js";

function actorContext(ctx: any): AuthorityContext | null {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId) return null;
  return { userId: Number(userId), chatId };
}

function replyTargetTelegramId(ctx: any): number | null {
  const rep = ctx.message?.reply_to_message;
  const id = rep?.from?.id;
  return id == null ? null : Number(id);
}

export function registerAdminCommands(registry: any) {
  const commands: CommandDef[] = [
    {
      name: "پنل",
      description: "پنل مدیریتی",
      handler: async (ctx) => {
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
      handler: async (ctx) => {
        const actx = actorContext(ctx);
        if (!actx) return;

        const decision = await authority.check(actx, RULE_OWNER_ONLY);
        if (!decision.allow) return;

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

        await ctx.reply("ناظر کل ثبت شد.");
      },
    },
    {
      name: "حذف ناظر",
      description: "حذف تمام نقش‌های ناظر/ادمین (با Reply)",
      handler: async (ctx) => {
        const actx = actorContext(ctx);
        if (!actx) return;

        const decision = await authority.check(actx, RULE_OWNER_ONLY);
        if (!decision.allow) return;

        const targetId = replyTargetTelegramId(ctx);
        if (!targetId) {
          await ctx.reply("روی پیام فرد Reply کن و بنویس: حذف ناظر");
          return;
        }

        await adminStore.removeAllRoles(targetId);
        await ctx.reply("تمام نقش‌ها برای این کاربر حذف شد.");
      },
    },
    {
      name: "لیست ناظرها",
      description: "نمایش لیست ناظرها",
      handler: async (ctx) => {
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

        const lines = roles.map((r: any) => {
          const chatPart = r.scope?.type === "CHAT" ? `(chat ${r.scope.chatId})` : "";
          return `• ${r.userId} — ${r.role} ${chatPart}`.trim();
        });

        await ctx.reply(["ناظرها:", ...lines].join("\n"));
      },
    },

    // ---------- ADMIN (GLOBAL) ----------
    {
      name: "افزودن ادمین",
      description: "افزودن ادمین کل (با Reply)",
      handler: async (ctx) => {
        const actx = actorContext(ctx);
        if (!actx) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

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

        await ctx.reply("ادمین کل ثبت شد.");
      },
    },
    {
      name: "حذف ادمین",
      description: "حذف نقش‌های ادمین (با Reply)",
      handler: async (ctx) => {
        const actx = actorContext(ctx);
        if (!actx) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

        const targetId = replyTargetTelegramId(ctx);
        if (!targetId) {
          await ctx.reply("روی پیام فرد Reply کن و بنویس: حذف ادمین");
          return;
        }

        // این نسخه ساده: همه نقش‌ها را حذف می‌کند (اگر می‌خواهی فقط ADMIN حذف شود، بگو)
        await adminStore.removeAllRoles(targetId);
        await ctx.reply("ادمین حذف شد.");
      },
    },
    {
      name: "لیست ادمین‌ها",
      description: "نمایش لیست ادمین‌ها",
      handler: async (ctx) => {
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

        const lines = roles.map((r: any) => `• ${r.userId} — ${r.role}`);
        await ctx.reply(["ادمین‌ها:", ...lines].join("\n"));
      },
    },

    // ---------- CHAT-SCOPED ----------
    {
      name: "افزودن ناظر چت",
      description: "افزودن ناظر برای همین چت (با Reply)",
      handler: async (ctx) => {
        const actx = actorContext(ctx);
        if (!actx || !actx.chatId) return;

        const decision = await authority.check(actx, RULE_OWNER_ONLY);
        if (!decision.allow) return;

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

        await ctx.reply("ناظر چت ثبت شد.");
      },
    },
    {
      name: "حذف ناظر چت",
      description: "حذف ناظر همین چت (با Reply)",
      handler: async (ctx) => {
        const actx = actorContext(ctx);
        if (!actx || !actx.chatId) return;

        const decision = await authority.check(actx, RULE_OWNER_ONLY);
        if (!decision.allow) return;

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

        await ctx.reply("ناظر چت حذف شد.");
      },
    },
    {
      name: "افزودن ادمین چت",
      description: "افزودن ادمین برای همین چت (با Reply)",
      handler: async (ctx) => {
        const actx = actorContext(ctx);
        if (!actx || !actx.chatId) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

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

        await ctx.reply("ادمین چت ثبت شد.");
      },
    },
    {
      name: "حذف ادمین چت",
      description: "حذف ادمین همین چت (با Reply)",
      handler: async (ctx) => {
        const actx = actorContext(ctx);
        if (!actx || !actx.chatId) return;

        const decision = await authority.check(actx, RULE_NAZER_OR_OWNER);
        if (!decision.allow) return;

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

        await ctx.reply("ادمین چت حذف شد.");
      },
    },
  ];

  for (const c of commands) registry.register(c);
}
