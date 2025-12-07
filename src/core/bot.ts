import { Bot } from "grammy";
import { MyContext } from "./types";
import { registerSecurityFeature } from "../features/security/guard";
import { registerWorldFeature } from "../features/world/travel";
import { registerWorldBuilderFeature } from "../features/worldbuilder/admin-builder";
import { registerVehicleTravelFeature } from "../features/world/travel-vehicles";
import { registerUiFeature } from "../features/ui/ui";

export function createBot(token: string): Bot<MyContext> {
  const bot = new Bot<MyContext>(token);

  // اینجا بقیه تنظیمات کانتکست و سشن که در پروژه خودت داری می‌آید

  // فیچرهای فعلی
  registerSecurityFeature(bot);
  registerWorldFeature(bot);
  registerWorldBuilderFeature(bot);
  registerVehicleTravelFeature(bot);

  // ماژول UI جدید (منوی اصلی و helper پاک‌کردن پیام)
  registerUiFeature(bot);

  return bot;
}