import type { CommandRegistry } from "../../core/commands/registry.js";

export function registerSystemModule(registry: CommandRegistry) {
  registry.register({
    name: "ping",
    aliases: ["بات"],
    description: "تست اتصال ربات",
    handler: async (ctx) => {
      await ctx.reply("pong ✅");
    },
  });

  registry.register({
    name: "start",
    aliases: ["شروع"],
    description: "پیام شروع/خوش‌آمد",
    handler: async (ctx) => {
      await ctx.reply("سلام! 👋\nبرای دیدن دستورها: /help");
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

      await ctx.reply(
        [
          `userId: ${userId}`,
          `chatId: ${chatId}`,
          `chatType: ${chatType}`,
          `OWNER_TELEGRAM_ID(env): ${process.env.OWNER_TELEGRAM_ID || "(empty)"}`,
        ].join("\n")
      );
    },
  });
}
