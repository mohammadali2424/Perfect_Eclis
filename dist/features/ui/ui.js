"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPvScreen = sendPvScreen;
exports.showMainMenu = showMainMenu;
exports.registerUiFeature = registerUiFeature;
const grammy_1 = require("grammy");
/**
 * یک «صفحه» در پی‌وی می‌فرستد:
 * - اگر قبلاً صفحه‌ای فرستاده شده، آن را حذف می‌کند
 * - آیدی پیام جدید را در سشن نگه می‌دارد
 */
async function sendPvScreen(ctx, text, keyboard) {
    var _a;
    // اگر پی‌وی نیست، فقط یک ریپلای معمولی بزن
    if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private") {
        await ctx.reply(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
        return;
    }
    const lastId = ctx.session.ui_last_message_id;
    if (lastId) {
        try {
            await ctx.api.deleteMessage(ctx.chat.id, lastId);
        }
        catch {
            // اگر پیام قبلی پاک نشده بود (مثلاً خیلی قدیمی یا دستکاری شده) بی‌خیال
        }
    }
    const msg = await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
    });
    ctx.session.ui_last_message_id = msg.message_id;
}
/**
 * منوی اصلی اکلیس در پی‌وی
 * این همون «صفحه هاب» است
 */
function buildMainMenu() {
    return new grammy_1.InlineKeyboard()
        .text("🧭 مسیر های من", "paths:open")
        .row()
        .text("🗺 نقشه سریع من", "mymap:open")
        .row()
        // اینجا ورودی اصلی سیستم حمل‌ونقله
        .text("🚦 حمل و نقل", "ride:menu");
}
async function showMainMenu(ctx) {
    const text = "📜 <b>اکلیس · منوی راه‌ها</b>\n\n" +
        "از اینجا می‌توانی مسیرهایت را ببینی، جای فعلی‌ات را چک کنی " +
        "و وارد منوی <b>حمل و نقل</b> (ماشین، مسافر، سوخت‌گیری و بعداً مونت‌ها) شوی.";
    await sendPvScreen(ctx, text, buildMainMenu());
}
/**
 * رجیستر کردن UI عمومی
 */
function registerUiFeature(bot) {
    // دکمه‌ی «🏠 منوی اصلی» اگر جایی ازش استفاده کردیم
    bot.callbackQuery("ui:home", async (ctx) => {
        var _a;
        if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private") {
            await ctx.answerCallbackQuery();
            return;
        }
        await ctx.answerCallbackQuery();
        await showMainMenu(ctx);
    });
    // /menu برای برگرداندن بازیکن به منوی اصلی
    bot.command("menu", async (ctx) => {
        var _a;
        if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private")
            return;
        await showMainMenu(ctx);
    });
    // اگر دوست داشتی در آینده با یک دکمه متنی هم برگردی:
    bot.hears("🏠 منوی اصلی", async (ctx) => {
        var _a;
        if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private")
            return;
        await showMainMenu(ctx);
    });
}
