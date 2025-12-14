"use strict";
// src/core/bot.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.bot = void 0;
const grammy_1 = require("grammy");
const config_1 = require("./config");
const supabase_1 = require("./supabase");
const guard_1 = require("../features/security/guard");
const onboarding_1 = require("../features/world/onboarding");
const travel_1 = require("../features/world/travel");
const ui_1 = require("../features/ui/ui");
const flux_builder_1 = require("../features/worldbuilder/flux-builder");
const travel_vehicles_1 = require("../features/world/travel-vehicles");
const admin_builder_1 = require("../features/worldbuilder/admin-builder");
const admin_commands_1 = require("../features/worldbuilder/admin-commands");
const path_builder_1 = require("../features/worldbuilder/path-builder");
const supabase_db_1 = require("./db/adapters/supabase-db");
const fuel_admin_1 = require("../features/economy/fuel-admin");
const vehicle_shop_1 = require("../features/economy/vehicle-shop");
if (!config_1.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is required");
}
// این همونیه که src/index.ts ازش استفاده می‌کنه
exports.bot = new grammy_1.Bot(config_1.BOT_TOKEN);
// سشن – یک آبجکت خالی که به SessionData کست می‌شه
exports.bot.use((0, grammy_1.session)({
    initial: () => ({}),
}));
// ✅ یک‌بار برای همیشه سرویس‌ها را بساز
const services = {
    supabase: supabase_1.supabase,
    db: (0, supabase_db_1.makeSupabaseDb)(supabase_1.supabase),
};
// ✅ تزریق سرویس‌ها به ctx
exports.bot.use(async (ctx, next) => {
    ctx.services = services;
    return next();
});
// ===== رجیستر تمام فیچرها =====
(0, guard_1.registerSecurityFeature)(exports.bot);
(0, admin_commands_1.registerWorldAdminCommands)(exports.bot);
(0, travel_vehicles_1.registerVehicleTravelFeature)(exports.bot);
(0, path_builder_1.registerPathBuilderFeature)(exports.bot);
(0, onboarding_1.registerOnboardingFeature)(exports.bot);
(0, admin_builder_1.registerWorldAdminFeature)(exports.bot);
(0, vehicle_shop_1.registerWorldVehicleShop)(exports.bot);
(0, travel_1.registerTravelFeature)(exports.bot);
(0, ui_1.registerUiFeature)(exports.bot);
(0, flux_builder_1.registerFluxBuilderFeature)(exports.bot);
(0, fuel_admin_1.registerFuelAdminFeature)(exports.bot);
// /start ساده برای راهنمای اولیه
exports.bot.command("start", async (ctx) => {
    var _a;
    if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private")
        return;
    await ctx.reply("به اکلیس خوش آمدی.\n" + "برای دیدن منوی اصلی بعداً می‌تونی از /menu استفاده کنی.");
});
