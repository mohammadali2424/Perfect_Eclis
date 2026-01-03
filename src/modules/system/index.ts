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
