import { CommandRegistry } from "../../core/commands/registry.js";
import { CommandCtx } from "../../core/commands/command.js";

type AdminStore = {
  isAdmin(userId: number): boolean;
  addAdmin(userId: number): void;
  removeAdmin(userId: number): void;
  listAdmins(): number[];
};

function getFromReplyUserId(ctx: CommandCtx): number | null {
  const msg: any = ctx.message;
  const r = msg?.reply_to_message;
  const uid = r?.from?.id;
  return typeof uid === "number" ? uid : null;
}

function denySilent(ctx: CommandCtx) {
  // برای جلوگیری از اسپم، کوتاه و رسمی
  return ctx.bot.telegram.sendMessage(ctx.message.chat.id, "دسترسی ندارید.");
}

function isOwner(ctx: CommandCtx): boolean {
  const me = ctx.message.from?.id;
  // OWNER_ID فعلاً از env در main به ctx تزریق نشده؛ پس ساده‌ترین حالت:
  // از فایل config یا env بخوانید. اگر فعلاً ندارید، همین را در main تزریق می‌کنیم (قدم C).
  // اینجا موقتاً false برمی‌گردانیم تا با inject درست شود.
  return false;
}

function isPrivileged(ctx: CommandCtx, ownerId: number, admins: AdminStore): boolean {
  const uid = ctx.message.from?.id;
  if (!uid) return false;
  if (uid === ownerId) return true;
  return admins.isAdmin(uid);
}

export function registerAdminModule(registry: CommandRegistry, deps: { ownerId: number; admins: AdminStore }) {
  // پنل
  registry.register("پنل", async (ctx: CommandCtx) => {
    if (!isPrivileged(ctx, deps.ownerId, deps.admins)) return denySilent(ctx);

    const chatId = ctx.message.chat.id;
    const uid = ctx.message.from?.id;

    const text =
      "پنل مدیریت\n" +
      "فرمان‌ها:\n" +
      "• ادمین افزودن (با ریپلای)\n" +
      "• ادمین حذف (با ریپلای)\n" +
      "• لیست ادمین‌ها\n";

    // اگر داخل گروه گفت، پنل را در PV هم می‌فرستیم، ولی اگر PV بسته بود حداقل همانجا جواب بده
    if (ctx.message.chat.type !== "private" && uid) {
      try {
        await ctx.bot.telegram.sendMessage(uid, text);
        await ctx.bot.telegram.sendMessage(chatId, "پنل در پی‌وی ارسال شد.");
        return;
      } catch {
        await ctx.bot.telegram.sendMessage(chatId, text);
        return;
      }
    }

    await ctx.bot.telegram.sendMessage(chatId, text);
  });

  // ادمین (افزودن/حذف)
  registry.register("ادمین", async (ctx: CommandCtx) => {
    if (!isPrivileged(ctx, deps.ownerId, deps.admins)) return denySilent(ctx);

    const args = ctx.args ?? [];
    const sub = (args[0] ?? "").trim();

    const targetId = getFromReplyUserId(ctx);
    if (!targetId) {
      return ctx.bot.telegram.sendMessage(
        ctx.message.chat.id,
        "باید روی پیام فرد ریپلای کنید.\nمثال: ریپلای → «ادمین افزودن»"
      );
    }

    if (sub === "افزودن") {
      deps.admins.addAdmin(targetId);
      return ctx.bot.telegram.sendMessage(ctx.message.chat.id, `ادمین اضافه شد: ${targetId}`);
    }

    if (sub === "حذف") {
      deps.admins.removeAdmin(targetId);
      return ctx.bot.telegram.sendMessage(ctx.message.chat.id, `ادمین حذف شد: ${targetId}`);
    }

    return ctx.bot.telegram.sendMessage(
      ctx.message.chat.id,
      "دستور نامعتبر.\nاستفاده:\n• ادمین افزودن (با ریپلای)\n• ادمین حذف (با ریپلای)"
    );
  });

  // لیست ادمین‌ها
  registry.register("لیست", async (ctx: CommandCtx) => {
    if (!isPrivileged(ctx, deps.ownerId, deps.admins)) return denySilent(ctx);

    const args = ctx.args ?? [];
    const subject = (args[0] ?? "").trim();

    if (subject !== "ادمین‌ها" && subject !== "ادمینها") {
      return ctx.bot.telegram.sendMessage(ctx.message.chat.id, "برای لیست ادمین‌ها بنویس: «لیست ادمین‌ها»");
    }

    const list = deps.admins.listAdmins();
    const text = list.length ? list.map((x) => `• ${x}`).join("\n") : "ادمینی ثبت نشده.";
    return ctx.bot.telegram.sendMessage(ctx.message.chat.id, text);
  });
}
