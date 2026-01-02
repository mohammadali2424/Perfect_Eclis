import type { CommandDef } from "../../core/commands/command.js";
import { InMemoryAdminStore } from "./adminStore.js";
import { AdminRoleProvider } from "./adminRoleProvider.js";

export const adminStore = new InMemoryAdminStore();
export const adminRoleProvider = new AdminRoleProvider(adminStore);

function actorId(ctx: any): number | null {
  const id = ctx.from?.id;
  return id === undefined || id === null ? null : Number(id);
}

function replyTargetTelegramId(ctx: any): number | null {
  const rep = ctx.message?.reply_to_message;
  const id = rep?.from?.id;
  return id === undefined || id === null ? null : Number(id);
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr)];
}

export function registerAdminModule(registry: any) {
  const commands: CommandDef[] = [
    {
      name: "افزودن ادمین",
      description: "با ریپلای روی کاربر: ادمین می‌کند",
      handler: async (ctx, deps) => {
        if (!(await ensurePrivileged(ctx))) return;
        const target = replyTargetTelegramId(ctx);
        if (!target) {
          await ctx.reply("برای افزودن ادمین، روی پیام کاربر ریپلای کن و بنویس: افزودن ادمین");
          return;
        }
        await addAdminRole(target, deps);
        await ctx.reply("ثبت شد: این کاربر ادمین شد.");
      },
    },
    {
      name: "حذف ادمین",
      description: "با ریپلای روی کاربر: ادمین را حذف می‌کند",
      handler: async (ctx, deps) => {
        if (!(await ensurePrivileged(ctx))) return;
        const target = replyTargetTelegramId(ctx);
        if (!target) {
          await ctx.reply("برای حذف ادمین، روی پیام کاربر ریپلای کن و بنویس: حذف ادمین");
          return;
        }
        await removeAdminRole(target, deps);
        await ctx.reply("ثبت شد: ادمین این کاربر حذف شد.");
      },
    },
    {
      name: "لیست ادمین",
      description: "لیست ادمین‌ها را نشان می‌دهد",
      handler: async (ctx, deps) => {
        if (!(await ensurePrivileged(ctx))) return;
        const admins = await listAdmins(deps);
        if (admins.length === 0) {
          await ctx.reply("فعلاً هیچ ادمینی ثبت نشده.");
          return;
        }
        const lines = admins.map((a: any) => {
          const u = a.username ? `@${a.username}` : "";
          return `• ${a.telegramId} ${u}`.trim();
        });
        await ctx.reply(["ادمین‌ها:", ...lines].join("\n"));
      },
    },
  ];

  for (const c of commands) registry.register(c);
}


