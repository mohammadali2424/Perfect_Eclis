import type { CommandRegistry } from "../../core/commands/registry.js";

export function registerSystemModule(registry: CommandRegistry) {
 
  registry.register({
    name: "start",
    aliases: ["شروع"],
    description: "پیام شروع/خوش‌آمد",
    handler: async (ctx) => {
      await ctx.reply("سلام! 👋\nبرای دیدن دستورها: /help");
    },
  });

  registry.register({
    name: "ping",
    aliases: ["پینگ"],
    description: "تست اتصال + سرعت پاسخ‌دهی",
    handler: async (ctx) => {
      const t0 = Date.now();

      const msgDateSec = (ctx.message as any)?.date as number | undefined;
      const telegramLatencyMs =
        typeof msgDateSec === "number" ? Math.max(0, Date.now() - msgDateSec * 1000) : null;

      const sent = await ctx.reply("pong");

      const t1 = Date.now();
      const botRoundTripSec = (t1 - t0) / 1000;

      const parts = [
        "pong ✅",
        `⏱ پاسخ‌دهی ربات: ${botRoundTripSec.toFixed(2)}s`,
        telegramLatencyMs !== null ? `📡 تاخیر تلگرام: ${(telegramLatencyMs / 1000).toFixed(2)}s` : null,
        `🆔 chat: ${(ctx.chat as any)?.id ?? "?"}`,
        `👤 user: ${(ctx.from as any)?.id ?? "?"}`,
      ].filter(Boolean);

      try {
        if (sent?.message_id) {
          await ctx.telegram.editMessageText(
            (ctx.chat as any).id,
            sent.message_id,
            undefined,
            parts.join("\n")
          );
          return;
        }
      } catch {
        // اگر ادیت نشد، پیام جدا می‌فرستیم
      }

      await ctx.reply(parts.join("\n"));
    },
  });


  registry.register({
  name: "آیدی من",
  aliases: ["ایدی من", "id me", "my id"],
  description: "نمایش آیدی تلگرام و چت",
  handler: async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const chatType = ctx.chat?.type;
    const username = ctx.from?.username ? `@${ctx.from.username}` : "(no username)";
    const fullName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ").trim();

    await ctx.reply(
      [
        `شناسه: ${username}`,
        `نام: ${fullName || "(no name)"}`,
        `userId: ${userId}`,
        `chatId: ${chatId}`,
        `chatType: ${chatType}`,
      ].join("\n")
    );
  },
});
}
