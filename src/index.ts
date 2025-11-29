import { bot } from "./core/bot";

async function main() {
  console.log("Starting bot in long-polling mode...");
  await bot.start();
}

main();
