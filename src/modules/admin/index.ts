// src/modules/admin/index.ts
import { createCommand } from "../../core/commands/command.js";
import type { CommandRegistry } from "../../core/commands/registry.js";
import type { CommandContext } from "../../core/commands/command.js";
import type { Role } from "../../core/types/entities.js";
import { env } from "../../config/env.js";

// اینجا فقط یک چک ساده داریم.
// OWNER_ID را از env می‌خوانیم (تو گفتی ثابت است).
function isOwner(ctx: CommandContext): boolean {
  const fromId = ctx.from?.id;
  if (!fromId) return false;
  return String(fromId) === String((env as any).OWNER_ID); // اگر تایپ env هنوز OWNER_ID را نمی‌شناسد
}

async function isAdminOrOwner(ctx: CommandContext): Promise<boolean> {
  if (isOwner(ctx)) return true;
  const fromId = ctx.from?.id;
  if (!fromId) return false;
  const p = await ctx.uow.repositories.players.getOrCreateFromTelegram(fromId, ctx.from?.username);
  return (p.roles ?? []).includes("admin");
}

async function setAdminRole(ctx: CommandContext, targetId: number, makeAdmin: boolean) {
  const repo = ctx.uow.repositories.players;
  const target = await repo.getOrCreateFromTelegram(targetId);

  const roles = new Set<Role>(target.roles ?? []);
  if (makeAdmin) roles.add("admin");
  else roles.delete("admin");

  await repo.setRoles(targetId, Array.from(roles));
}

export function registerAdminModule(registry: CommandRegistry) {
  // پنل
  registry.register(
    createCommand({
      name: "پنل",
      description: "پنل مدیریت",
      handler: async (ctx: CommandContext) => {
        if (!(await isAdminOrOwner(ctx))) return;

        await ctx.reply(
          [
            "پنل مدیریت اکلیس",
            "",
            "دستورها:",
            "پنل",
            "لیست ادمین‌ها",
            "افزودن ادمین (ریپلای روی پیام هدف)",
            "حذف ادمین (ریپلای روی پیام هدف)",
          ].join("\n")
        );
      },
    })
  );

  // لیست ادمین‌ها
  registry.register(
    createCommand({
      name: "لیست ادمین‌ها",
      description: "نمایش ادمین‌ها",
      handler: async (ctx: CommandContext) => {
        if (!(await isAdminOrOwner(ctx))) return;

        const admins = await ctx.uow.repositories.players.listAdmins();
        if (!admins.length) {
          await ctx.reply("ادمینی ثبت نشده.");
          return;
        }
        const lines = admins.map((a) => `• ${a.id}${a.username ? ` (@${a.username})` : ""}`);
        await ctx.reply(["ادمین‌ها:", ...lines].join("\n"));
      },
    })
  );

  // افزودن ادمین (فقط Owner)
  registry.register(
    createCommand({
      name: "افزودن ادمین",
      description: "افزودن ادمین با ریپلای (Owner فقط)",
      handler: async (ctx: CommandContext) => {
        if (!isOwner(ctx)) return;

        const replyFrom = ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message?.from : undefined;
        if (!replyFrom?.id) {
          await ctx.reply("باید روی پیام فرد موردنظر ریپلای کنی و بعد بنویسی: افزودن ادمین");
          return;
        }

        await setAdminRole(ctx, replyFrom.id, true);
        await ctx.reply(`ادمین اضافه شد: ${replyFrom.id}${replyFrom.username ? ` (@${replyFrom.username})` : ""}`);
      },
    })
  );

  // حذف ادمین (فقط Owner)
  registry.register(
    createCommand({
      name: "حذف ادمین",
      description: "حذف ادمین با ریپلای (Owner فقط)",
      handler: async (ctx: CommandContext) => {
        if (!isOwner(ctx)) return;

        const replyFrom = ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message?.from : undefined;
        if (!replyFrom?.id) {
          await ctx.reply("باید روی پیام فرد موردنظر ریپلای کنی و بعد بنویسی: حذف ادمین");
          return;
        }

        await setAdminRole(ctx, replyFrom.id, false);
        await ctx.reply(`ادمین حذف شد: ${replyFrom.id}${replyFrom.username ? ` (@${replyFrom.username})` : ""}`);
      },
    })
  );
}
