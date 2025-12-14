"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFuelAdminFeature = registerFuelAdminFeature;
// src/features/economy/fuel-admin.ts
const grammy_1 = require("grammy");
function kindTitle(kind) {
    return kind === "normal" ? "چاه فلوکس" : "چاه اضطراری فلوکس";
}
async function getWellEnabled(supabase, spotId, kind) {
    const { data, error } = await supabase
        .from("flux_wells")
        .select("enabled")
        .eq("spot_id", spotId)
        .eq("kind", kind)
        .maybeSingle();
    if (error) {
        console.error("getWellEnabled error:", error);
        return false;
    }
    return Boolean(data === null || data === void 0 ? void 0 : data.enabled);
}
async function toggleWell(supabase, spotId, kind) {
    const current = await getWellEnabled(supabase, spotId, kind);
    const next = !current;
    const { error } = await supabase
        .from("flux_wells")
        .upsert({
        spot_id: spotId,
        kind,
        enabled: next,
        updated_at: new Date().toISOString(),
    }, { onConflict: "spot_id,kind" });
    if (error) {
        console.error("toggleWell upsert error:", error);
        return current; // اگر خطا خورد، همون قبلی رو برگردون
    }
    return next;
}
async function buildSpotsKeyboard(ctx, kind) {
    var _a;
    const { supabase } = ctx.services;
    // اگر جدول spots فیلد region_id/title داره، همین خوبه
    const { data: spots, error } = await supabase
        .from("spots")
        .select("id, title, region_id")
        .order("region_id", { ascending: true })
        .order("id", { ascending: true });
    if (error || !spots) {
        console.error("load spots error:", error);
        return new grammy_1.InlineKeyboard().text("🔄 تلاش دوباره", `flux:open:${kind}`);
    }
    const kb = new grammy_1.InlineKeyboard();
    // برای اینکه درخواست DB زیاد نشه، وضعیت‌ها رو یکجا بگیر:
    const spotIds = spots.map((s) => s.id);
    const { data: wells } = await supabase
        .from("flux_wells")
        .select("spot_id, kind, enabled")
        .in("spot_id", spotIds)
        .eq("kind", kind);
    const enabledMap = new Map();
    for (const w of wells !== null && wells !== void 0 ? wells : [])
        enabledMap.set(w.spot_id, Boolean(w.enabled));
    for (const s of spots) {
        const enabled = (_a = enabledMap.get(s.id)) !== null && _a !== void 0 ? _a : false;
        const mark = enabled ? "✅" : "❌";
        kb.text(`${mark} ${s.title}`, `flux:set:${s.id}:${kind}`).row();
    }
    kb.text("🏠 منوی اصلی", "ui:home");
    return kb;
}
function registerFuelAdminFeature(bot) {
    // ادمین‌چک اگر داری، اینجا بذار. فعلاً همون حالت ساده:
    bot.hears("ساخت چاه فلوکس", async (ctx) => {
        var _a;
        if (!ctx.from)
            return;
        // پیام گروه پاک شود
        if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private") {
            try {
                await ctx.deleteMessage();
            }
            catch { }
        }
        // برو پیوی
        await ctx.api.sendMessage(ctx.from.id, `🛠 پنل ساخت ${kindTitle("normal")}\n` +
            "روی هر منطقه/اسپات بزن تا فعال/غیرفعال شود:", { reply_markup: await buildSpotsKeyboard(ctx, "normal") });
    });
    bot.hears("ساخت چاه اضطراری فلوکس", async (ctx) => {
        var _a;
        if (!ctx.from)
            return;
        if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private") {
            try {
                await ctx.deleteMessage();
            }
            catch { }
        }
        await ctx.api.sendMessage(ctx.from.id, `🛠 پنل ساخت ${kindTitle("emergency")}\n` +
            "روی هر منطقه/اسپات بزن تا فعال/غیرفعال شود:", { reply_markup: await buildSpotsKeyboard(ctx, "emergency") });
    });
    // (اختیاری) برای دکمه‌ی تلاش دوباره
    bot.callbackQuery(/^flux:open:(normal|emergency)$/, async (ctx) => {
        const kind = ctx.match[1];
        await ctx.editMessageReplyMarkup({
            reply_markup: await buildSpotsKeyboard(ctx, kind),
        });
        await ctx.answerCallbackQuery();
    });
    // ✅ این همون چیزیه که پنلت کم داشت: toggle واقعی
    bot.callbackQuery(/^flux:set:(\d+):(normal|emergency)$/, async (ctx) => {
        const spotId = Number(ctx.match[1]);
        const kind = ctx.match[2];
        const { supabase } = ctx.services;
        // toggle در DB
        const enabledNow = await toggleWell(supabase, spotId, kind);
        // آپدیت کیبورد همان پیام
        try {
            await ctx.editMessageReplyMarkup({
                reply_markup: await buildSpotsKeyboard(ctx, kind),
            });
        }
        catch (e) {
            // اگر پیام قدیمی بود یا قابل ادیت نبود، مهم نیست
            console.warn("editMessageReplyMarkup failed:", e);
        }
        await ctx.answerCallbackQuery(enabledNow ? `✅ ${kindTitle(kind)} فعال شد` : `❌ ${kindTitle(kind)} غیرفعال شد`);
    });
}
