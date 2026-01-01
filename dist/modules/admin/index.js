import { isPrivileged } from "../../core/auth/access.js";
function actorId(ctx) {
    const id = ctx.from?.id;
    return id === undefined || id === null ? null : Number(id);
}
function replyTargetTelegramId(ctx) {
    const rep = ctx.message?.reply_to_message;
    const id = rep?.from?.id;
    return id === undefined || id === null ? null : Number(id);
}
function uniq(arr) {
    return [...new Set(arr)];
}
async function ensurePrivileged(ctx) {
    const id = actorId(ctx);
    return id !== null ? isPrivileged(id) : false;
}
async function addAdminRole(targetTelegramId, deps) {
    const p = await deps.uow.players.getOrCreateFromTelegram(targetTelegramId);
    const roles = uniq([...(p.roles || []), "admin"]);
    await deps.uow.players.update({ id: p.id, roles });
    await deps.uow.commit();
    return { player: p, roles };
}
async function removeAdminRole(targetTelegramId, deps) {
    const p = await deps.uow.players.getOrCreateFromTelegram(targetTelegramId);
    const roles = (p.roles || []).filter((r) => r !== "admin");
    await deps.uow.players.update({ id: p.id, roles });
    await deps.uow.commit();
    return { player: p, roles };
}
async function listAdmins(deps) {
    return deps.uow.players.listAdmins();
}
export function registerAdminModule(registry) {
    const commands = [
        {
            name: "افزودن ادمین",
            description: "با ریپلای روی کاربر: ادمین می‌کند",
            handler: async (ctx, deps) => {
                if (!(await ensurePrivileged(ctx)))
                    return;
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
                if (!(await ensurePrivileged(ctx)))
                    return;
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
                if (!(await ensurePrivileged(ctx)))
                    return;
                const admins = await listAdmins(deps);
                if (admins.length === 0) {
                    await ctx.reply("فعلاً هیچ ادمینی ثبت نشده.");
                    return;
                }
                const lines = admins.map((a) => {
                    const u = a.username ? `@${a.username}` : "";
                    return `• ${a.telegramId} ${u}`.trim();
                });
                await ctx.reply(["ادمین‌ها:", ...lines].join("\n"));
            },
        },
    ];
    for (const c of commands)
        registry.register(c);
}
