
import { bot } from "./core/bot";

async function main() {
  await bot.api.setMyCommands([
    { command: "start", description: "شروع" },
    { command: "worldadmin", description: "پنل مدیریت نقشه برای ارباب" },
    { command: "path", description: "نمایش مسیرهای قابل سفر" },
    { command: "regplayer", description: "ثبت بازیکن (فقط ارباب)" },
  ]);

  console.log("Starting bot in long-polling mode...");
  await bot.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
});
