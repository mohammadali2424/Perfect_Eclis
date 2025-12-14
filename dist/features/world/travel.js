"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTravelFeature = registerTravelFeature;
// src/features/world/travel.ts
const grammy_1 = require("grammy");
const travel_vehicles_1 = require("./travel-vehicles");
const travel_vehicles_2 = require("./travel-vehicles");
const config_1 = require("../../core/config");
const INACTIVE_DAYS = 7;
// --- helper: پاک کردن پیام قبلی و ساخت یک صفحه‌ی جدید در PV ---
async function sendScreen(ctx, text, keyboard) {
    var _a;
    if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) === "private") {
        const lastId = ctx.session.ui_last_message_id;
        if (lastId) {
            try {
                await ctx.api.deleteMessage(ctx.chat.id, lastId);
            }
            catch {
                // مهم نیست اگر پاک نشد
            }
        }
        const msg = await ctx.reply(text, {
            reply_markup: keyboard,
            parse_mode: "HTML",
        });
        ctx.session.ui_last_message_id = msg.message_id;
    }
    else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: "HTML" });
    }
}
// --- helper: گرفتن / ساختن کاراکتر بر اساس tg_id ---
async function ensureCharacterFor(ctx, tgId) {
    const { supabase } = ctx.services;
    const { data, error } = await supabase
        .from("characters")
        .select("*")
        .eq("tg_id", tgId)
        .maybeSingle();
    if (error) {
        console.error("ensureCharacterFor select error:", error);
        await ctx.reply("در خواندن اطلاعات شخصیتت مشکلی پیش آمد.");
        return null;
    }
    if (data)
        return data;
    // اگر شخصیت هنوز ثبت نشده باشد، یک سطر مینیمال می‌سازیم
    const insert = {
        tg_id: tgId,
        char_name: null,
        clan_name: null,
        current_region_id: null,
        current_spot_id: null,
        pending_region_id: null,
        pending_spot_id: null,
        travel_ready_at: null,
        travel_total_seconds: null,
        travel_started_at: null,
        last_move_at: null,
        riding_vehicle_id: null,
    };
    const { data: ins, error: insErr } = await supabase
        .from("characters")
        .insert(insert)
        .select("*")
        .maybeSingle();
    if (insErr || !ins) {
        console.error("ensureCharacterFor insert error:", insErr);
        await ctx.reply("نتوانستم شخصیتت را بسازم.");
        return null;
    }
    return ins;
}
function isTraveling(char) {
    return !!(char.pending_region_id && char.pending_spot_id);
}
async function showTravelInProgress(ctx, char) {
    const now = new Date();
    let remainText = "";
    if (char.travel_ready_at) {
        const readyAt = new Date(char.travel_ready_at);
        const diff = Math.ceil((readyAt.getTime() - now.getTime()) / 1000);
        if (diff > 0) {
            remainText = `حدود ${diff} ثانیه تا رسیدن باقی مانده.\n`;
        }
        else {
            remainText = "زمان تقریبی سفر گذشته است، اما هنوز مقصد را نهایی نکرده‌ای.\n";
        }
    }
    const text = "🚶 در حال سفر هستی.\n" +
        remainText +
        "\n" +
        "می‌توانی با «رسیدم؟» سفر را تمام کنی، یا با «لغو مسیر» سفر را لغو کرده و به وضعیت قبلی برگردی.";
    const kb = new grammy_1.InlineKeyboard()
        .text("🚶 رسیدم؟", "travel:arrive")
        .row()
        .text("❌ لغو مسیر", "travel:cancel");
    await sendScreen(ctx, text, kb);
}
// --- منوی fallback (فقط یک دکمه برگشت) ---
function buildMainMenu() {
    return new grammy_1.InlineKeyboard().text("🔙 بازگشت", "travel:home");
}
// --- منوی وضعیت: پیاده یا سوار وسیله ---
async function showTravelHome(ctx) {
    var _a, _b;
    if (!ctx.from)
        return;
    if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private")
        return;
    const { supabase } = ctx.services;
    const char = await ensureCharacterFor(ctx, ctx.from.id);
    if (!char)
        return;
    // اگر در حال سفر است → فقط صفحه‌ی سفر
    if (isTraveling(char)) {
        await showTravelInProgress(ctx, char);
        return;
    }
    if (!char.current_region_id || !char.current_spot_id) {
        await sendScreen(ctx, "هنوز در هیچ Region / Spotـی ثبت نشده‌ای.\n" +
            "ارباب باید در یکی از گروه‌ها روی پیامت ریپلای کند و «ثبت پلیر» را بفرستد.", buildMainMenu());
        return;
    }
    const { data: region, error: regErr } = await supabase
        .from("regions")
        .select("*")
        .eq("id", char.current_region_id)
        .maybeSingle();
    const { data: spot, error: spotErr } = await supabase
        .from("spots")
        .select("*")
        .eq("id", char.current_spot_id)
        .maybeSingle();
    if (regErr || spotErr || !region || !spot) {
        console.error("showTravelHome region/spot error:", regErr || spotErr);
        await sendScreen(ctx, "در خواندن موقعیت فعلی‌ات مشکلی پیش آمد.", buildMainMenu());
        return;
    }
    let text = "";
    const kb = new grammy_1.InlineKeyboard();
    // --- از اینجا به بعد مثل قبل، فقط clan رو حذف می‌کنیم و fuel رو هم اینجا نشان نمی‌دهیم ---
    if (char.riding_vehicle_id) {
        const { data: vehicle, error: vehErr } = await supabase
            .from("vehicles")
            .select("id, title, current_region_id, current_spot_id, current_driver_char_id")
            .eq("id", char.riding_vehicle_id)
            .maybeSingle();
        if (vehErr || !vehicle) {
            console.error("showTravelHome vehicle error:", vehErr);
            char.riding_vehicle_id = null;
        }
        else {
            const isDriver = vehicle.current_driver_char_id === char.id;
            text += `منطقه: ${region.title}\n`;
            text += `موقعیت: ${spot.title}\n`;
            text += `وضعیت: سوار ماشین\n`;
            text += `نام وسیله: ${(_b = vehicle.title) !== null && _b !== void 0 ? _b : "وسیله‌ی ناشناس"}\n`;
            text += `\nمسیرهای شما:\n`;
            kb.text("🧭 مسیرهای من", "paths:list").row();
            if (isDriver) {
                kb.text("🎛 صفحه پشت فرمون", "veh:dash").row();
                kb.text("📦 صندوق عقب ماشین", "veh:trunk").row();
            }
            kb.text("🚶 پیاده می‌شوم", `veh:leave:${vehicle.id}`).row();
            await sendScreen(ctx, text, kb);
            return;
        }
    }
    // پیاده
    text += `منطقه: ${region.title}\n`;
    text += `موقعیت: ${spot.title}\n`;
    text += `وضعیت: پیاده\n`;
    text += `\nمسیرهای شما:\n`;
    kb.text("🧭 مسیرهای پیش‌رو", "paths:list").row();
    kb.text("🚕 سوار می‌شوم", "ride:home");
    await sendScreen(ctx, text, kb);
}
// --- نمایش مسیرهای قابل حرکت از Spot فعلی ---
async function openPaths(ctx) {
    var _a, _b, _c, _d, _e, _f;
    if (!ctx.from)
        return;
    if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private")
        return;
    const { supabase } = ctx.services;
    const char = await ensureCharacterFor(ctx, ctx.from.id);
    if (!char)
        return;
    if (!char.current_region_id || !char.current_spot_id) {
        await sendScreen(ctx, "هنوز در هیچ Region / Spotـی ثبت نشده‌ای.\n" +
            "ارباب باید در یکی از گروه‌ها روی پیامت ریپلای کند و «ثبت پلیر» را بفرستد.", buildMainMenu());
        return;
    }
    const { data: spot, error: spotErr } = await supabase
        .from("spots")
        .select("*")
        .eq("id", char.current_spot_id)
        .maybeSingle();
    const { data: region, error: regErr } = await supabase
        .from("regions")
        .select("*")
        .eq("id", char.current_region_id)
        .maybeSingle();
    if (spotErr || regErr || !spot || !region) {
        console.error("openPaths region/spot error:", spotErr || regErr);
        await sendScreen(ctx, "در خواندن موقعیت فعلی‌ات مشکلی پیش آمد.", buildMainMenu());
        return;
    }
    const { data: edges, error: edgeErr } = await supabase
        .from("edges")
        .select("id, from_spot_id, to_spot_id, travel_seconds, drive_seconds")
        .eq("from_spot_id", spot.id);
    if (edgeErr) {
        console.error("openPaths edges error:", edgeErr);
        await sendScreen(ctx, "در خواندن مسیرهای اطراف مشکلی پیش آمد.", buildMainMenu());
        return;
    }
    if (!edges || edges.length === 0) {
        await sendScreen(ctx, `📍 موقعیت فعلی:\nRegion: ${region.title}\nSpot: ${spot.title}\n\n` +
            "هیچ مسیری از این نقطه تعریف نشده.", buildMainMenu());
        return;
    }
    const toSpotIds = edges.map((e) => e.to_spot_id);
    const { data: toSpots, error: toSpotErr } = await supabase
        .from("spots")
        .select("id, title, region_id")
        .in("id", toSpotIds);
    if (toSpotErr) {
        console.error("openPaths toSpots error:", toSpotErr);
    }
    const toSpotMap = new Map();
    (toSpots !== null && toSpots !== void 0 ? toSpots : []).forEach((s) => {
        toSpotMap.set(s.id, s);
    });
    // ببینیم سوار وسیله هست یا نه
    let ridingVehicle = null;
    let isDriver = false;
    if (char.riding_vehicle_id) {
        const { data: vehicle, error: vehErr } = await supabase
            .from("vehicles")
            .select("id, title, owner_char_id, current_driver_char_id")
            .eq("id", char.riding_vehicle_id)
            .maybeSingle();
        if (!vehErr && vehicle) {
            ridingVehicle = vehicle;
            isDriver = vehicle.current_driver_char_id === char.id;
        }
    }
    const kb = new grammy_1.InlineKeyboard();
    let textHeader = `📍 موقعیت فعلی:\nRegion: ${region.title}\nSpot: ${spot.title}\n`;
    if (ridingVehicle && isDriver) {
        textHeader += `\n🚗 وضعیت: راننده‌ی «${ridingVehicle.title}» هستی.\n`;
    }
    else if (ridingVehicle && !isDriver) {
        textHeader += `\n🚕 وضعیت: مسافر روی «${ridingVehicle.title}» هستی.\n`;
    }
    else {
        textHeader += `\n🚶 وضعیت: پیاده‌ای.\n`;
    }
    textHeader += "\nراه‌هایی که از این نقطه در برابر تو آشکار می‌شوند:\n\n";
    let textBody = "";
    if (ridingVehicle && !isDriver) {
        textBody +=
            "تو به عنوان مسافر سوار هستی؛ فقط راننده می‌تواند مسیر را انتخاب کند.\n" +
                "برای پیاده شدن، از منوی وضعیت روی «🚶 پیاده می‌شوم» بزن.\n";
    }
    else if (ridingVehicle && isDriver) {
        // رانندگی
        for (const e of edges) {
            const dest = toSpotMap.get(e.to_spot_id);
            const destTitle = (_b = dest === null || dest === void 0 ? void 0 : dest.title) !== null && _b !== void 0 ? _b : `Spot #${e.to_spot_id}`;
            const driveSec = (_d = (_c = e.drive_seconds) !== null && _c !== void 0 ? _c : e.travel_seconds) !== null && _d !== void 0 ? _d : 0;
            textBody += `🚗 ➤ ${destTitle} ~ ${driveSec} ثانیه‌ی رانندگی\n`;
            kb
                .text(`🚗 ${destTitle} (${driveSec}s)`, `veh:go:${e.id}:${ridingVehicle.id}`)
                .row();
        }
    }
    else {
        // پیاده‌روی
        for (const e of edges) {
            const dest = toSpotMap.get(e.to_spot_id);
            const destTitle = (_e = dest === null || dest === void 0 ? void 0 : dest.title) !== null && _e !== void 0 ? _e : `Spot #${e.to_spot_id}`;
            const walkSec = (_f = e.travel_seconds) !== null && _f !== void 0 ? _f : 0;
            textBody += `➤ ${destTitle} ~ ${walkSec} ثانیه‌ی سفر پیاده\n`;
            kb.text(`➤ ${destTitle} (${walkSec}s)`, `go:${e.id}`).row();
        }
    }
    kb.text("🔄 تازه‌سازی", "paths:list").row().text("🔙 بازگشت", "travel:home");
    await sendScreen(ctx, textHeader + textBody, kb);
}
// --- شروع سفر پیاده از روی Edge ---
async function startWalkTravel(ctx, edgeId) {
    var _a;
    if (!ctx.from)
        return;
    const { supabase } = ctx.services;
    const char = await ensureCharacterFor(ctx, ctx.from.id);
    if (!char)
        return;
    if (!char.current_spot_id || !char.current_region_id) {
        await ctx.answerCallbackQuery({
            text: "موقعیت فعلی‌ات مشخص نیست.",
            show_alert: true,
        });
        return;
    }
    const { data: edge, error: edgeErr } = await supabase
        .from("edges")
        .select("id, from_spot_id, to_spot_id, travel_seconds")
        .eq("id", edgeId)
        .maybeSingle();
    if (edgeErr || !edge) {
        await ctx.answerCallbackQuery({
            text: "این مسیر دیگر در دسترس نیست.",
            show_alert: true,
        });
        return;
    }
    if (edge.from_spot_id !== char.current_spot_id) {
        await ctx.answerCallbackQuery({
            text: "از این نقطه نمی‌توانی وارد این مسیر شوی.",
            show_alert: true,
        });
        return;
    }
    const { data: destSpot, error: dsErr } = await supabase
        .from("spots")
        .select("id, region_id, title")
        .eq("id", edge.to_spot_id)
        .maybeSingle();
    if (dsErr || !destSpot) {
        await ctx.answerCallbackQuery({
            text: "نقطه‌ی مقصد پیدا نشد.",
            show_alert: true,
        });
        return;
    }
    const { data: destRegion, error: drErr } = await supabase
        .from("regions")
        .select("*")
        .eq("id", destSpot.region_id)
        .maybeSingle();
    if (drErr || !destRegion) {
        await ctx.answerCallbackQuery({
            text: "منطقه‌ی مقصد پیدا نشد.",
            show_alert: true,
        });
        return;
    }
    const travelSeconds = (_a = edge.travel_seconds) !== null && _a !== void 0 ? _a : 0;
    if (travelSeconds <= 0) {
        await ctx.answerCallbackQuery({
            text: "زمان این مسیر درست تنظیم نشده.",
            show_alert: true,
        });
        return;
    }
    const now = new Date();
    const readyAt = new Date(now.getTime() + travelSeconds * 1000);
    const { error: updErr } = await supabase
        .from("characters")
        .update({
        pending_region_id: destRegion.id,
        pending_spot_id: destSpot.id,
        travel_started_at: now.toISOString(),
        travel_ready_at: readyAt.toISOString(),
        travel_total_seconds: travelSeconds,
        last_move_at: now.toISOString(),
    })
        .eq("id", char.id);
    if (updErr) {
        console.error("startWalkTravel update error:", updErr);
        await ctx.answerCallbackQuery({
            text: "در شروع سفر مشکلی پیش آمد.",
            show_alert: true,
        });
        return;
    }
    await ctx.answerCallbackQuery({
        text: "سفر آغاز شد.",
        show_alert: false,
    });
    const kb = new grammy_1.InlineKeyboard()
        .text("🚶 رسیدم؟", "travel:arrive")
        .row()
        .text("❌ لغو مسیر", "travel:cancel");
    await sendScreen(ctx, `🚶 در حال حرکت به سمت «${destRegion.title} / ${destSpot.title}» هستی.\n` +
        `زمان تقریبی سفر: ${travelSeconds} ثانیه.\n\n` +
        "هر وقت فکر کردی زمانش گذشته، روی «رسیدم؟» بزن.\n" +
        "اگر خواستی منصرف شوی روی «لغو مسیر» بزن.", kb);
}
// --- شروع سفر رانندگی از روی Edge ---
async function startDriveTravel(ctx, edgeId, vehicleId) {
    var _a, _b, _c;
    if (!ctx.from)
        return;
    const { supabase } = ctx.services;
    const char = await ensureCharacterFor(ctx, ctx.from.id);
    if (!char)
        return;
    if (!char.current_spot_id || !char.current_region_id) {
        await ctx.answerCallbackQuery({
            text: "موقعیت فعلی‌ات مشخص نیست.",
            show_alert: true,
        });
        return;
    }
    // وسیله را برای اطمینان بخوانیم
    const { data: vehicle, error: vehErr } = await supabase
        .from("vehicles")
        .select("id, title, owner_char_id, current_driver_char_id, fuel_percent, current_region_id, current_spot_id")
        .eq("id", vehicleId)
        .maybeSingle();
    if (vehErr || !vehicle) {
        await ctx.answerCallbackQuery({
            text: "وسیله پیدا نشد.",
            show_alert: true,
        });
        return;
    }
    if (vehicle.current_driver_char_id !== char.id) {
        await ctx.answerCallbackQuery({
            text: "تو راننده‌ی این وسیله نیستی.",
            show_alert: true,
        });
        return;
    }
    if (vehicle.current_region_id !== char.current_region_id ||
        vehicle.current_spot_id !== char.current_spot_id) {
        await ctx.answerCallbackQuery({
            text: "باید همان‌جا که وسیله پارک است ایستاده باشی.",
            show_alert: true,
        });
        return;
    }
    const { data: edge, error: edgeErr } = await supabase
        .from("edges")
        .select("id, from_spot_id, to_spot_id, travel_seconds, drive_seconds")
        .eq("id", edgeId)
        .maybeSingle();
    if (edgeErr || !edge) {
        await ctx.answerCallbackQuery({
            text: "این مسیر دیگر در دسترس نیست.",
            show_alert: true,
        });
        return;
    }
    if (edge.from_spot_id !== char.current_spot_id) {
        await ctx.answerCallbackQuery({
            text: "از این نقطه نمی‌توانی وارد این مسیر شوی.",
            show_alert: true,
        });
        return;
    }
    const { data: destSpot, error: dsErr } = await supabase
        .from("spots")
        .select("id, region_id, title")
        .eq("id", edge.to_spot_id)
        .maybeSingle();
    if (dsErr || !destSpot) {
        await ctx.answerCallbackQuery({
            text: "نقطه‌ی مقصد پیدا نشد.",
            show_alert: true,
        });
        return;
    }
    const { data: destRegion, error: drErr } = await supabase
        .from("regions")
        .select("*")
        .eq("id", destSpot.region_id)
        .maybeSingle();
    if (drErr || !destRegion) {
        await ctx.answerCallbackQuery({
            text: "منطقه‌ی مقصد پیدا نشد.",
            show_alert: true,
        });
        return;
    }
    const driveSeconds = (_b = (_a = edge.drive_seconds) !== null && _a !== void 0 ? _a : edge.travel_seconds) !== null && _b !== void 0 ? _b : 0;
    if (driveSeconds <= 0) {
        await ctx.answerCallbackQuery({
            text: "زمان رانندگی این مسیر درست تنظیم نشده.",
            show_alert: true,
        });
        return;
    }
    const now = new Date();
    const readyAt = new Date(now.getTime() + driveSeconds * 1000);
    const { error: updErr } = await supabase
        .from("characters")
        .update({
        pending_region_id: destRegion.id,
        pending_spot_id: destSpot.id,
        travel_started_at: now.toISOString(),
        travel_ready_at: readyAt.toISOString(),
        travel_total_seconds: driveSeconds,
        last_move_at: now.toISOString(),
    })
        .eq("id", char.id);
    if (updErr) {
        console.error("startDriveTravel update error:", updErr);
        await ctx.answerCallbackQuery({
            text: "در شروع سفر با وسیله مشکلی پیش آمد.",
            show_alert: true,
        });
        return;
    }
    await ctx.answerCallbackQuery({
        text: "سفر با وسیله آغاز شد.",
        show_alert: false,
    });
    const kb = new grammy_1.InlineKeyboard()
        .text("🚶 رسیدم؟", "travel:arrive")
        .row()
        .text("❌ لغو مسیر", "travel:cancel");
    await sendScreen(ctx, `🚗 در حال حرکت با «${(_c = vehicle.title) !== null && _c !== void 0 ? _c : "وسیله"}» به سمت «${destRegion.title} / ${destSpot.title}» هستی.\n` +
        `زمان تقریبی سفر: ${driveSeconds} ثانیه.\n\n` +
        "هر وقت فکر کردی زمانش گذشته، روی «رسیدم؟» بزن.\n" +
        "اگر خواستی منصرف شوی روی «لغو مسیر» بزن.", kb);
}
async function handleCancelTravel(ctx) {
    var _a;
    if (!ctx.from)
        return;
    if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private")
        return;
    const { supabase } = ctx.services;
    const { data: char, error: charErr } = await supabase
        .from("characters")
        .select("*")
        .eq("tg_id", ctx.from.id)
        .maybeSingle();
    if (charErr || !char) {
        await ctx.reply("شخصیتت پیدا نشد.");
        return;
    }
    if (!isTraveling(char)) {
        await sendScreen(ctx, "در حال حاضر در سفری نیستی که لغوش کنی.", buildMainMenu());
        return;
    }
    const { error: updErr } = await supabase
        .from("characters")
        .update({
        pending_region_id: null,
        pending_spot_id: null,
        travel_started_at: null,
        travel_ready_at: null,
        travel_total_seconds: null,
    })
        .eq("id", char.id);
    if (updErr) {
        console.error("handleCancelTravel update error:", updErr);
        await sendScreen(ctx, "در لغو سفر مشکلی پیش آمد.", buildMainMenu());
        return;
    }
    await sendScreen(ctx, "سفر لغو شد. در همان موقعیت قبلی‌ات باقی ماندی.", buildMainMenu());
}
async function handleArrive(ctx) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    if (!ctx.from)
        return;
    if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private")
        return;
    const { supabase } = ctx.services;
    const { data: char, error: charErr } = await supabase
        .from("characters")
        .select("*")
        .eq("tg_id", ctx.from.id)
        .maybeSingle();
    if (charErr || !char) {
        await ctx.reply("شخصیتت پیدا نشد.");
        return;
    }
    const fromSpotId = (_b = char.current_spot_id) !== null && _b !== void 0 ? _b : null;
    const prevRegionId = (_c = char.current_region_id) !== null && _c !== void 0 ? _c : null;
    if (!char.pending_region_id || !char.pending_spot_id || !char.travel_ready_at) {
        await sendScreen(ctx, "الان در حال سفر نیستی.\n" + "برای حرکت جدید از «🧭 مسیر های من» استفاده کن.", buildMainMenu());
        return;
    }
    const now = new Date();
    const readyAt = new Date(char.travel_ready_at);
    if (now < readyAt) {
        const remainSec = Math.ceil((readyAt.getTime() - now.getTime()) / 1000);
        await sendScreen(ctx, `هنوز به مقصد نرسیده‌ای.\n` + `حدود ${remainSec} ثانیه‌ی دیگر باقی مانده.`, buildMainMenu());
        return;
    }
    // مقصد
    const { data: destSpot, error: dsErr } = await supabase
        .from("spots")
        .select("id, region_id, title")
        .eq("id", char.pending_spot_id)
        .maybeSingle();
    if (dsErr || !destSpot) {
        console.error("arrive destSpot error:", dsErr);
        await sendScreen(ctx, "نقطه‌ی مقصد پیدا نشد، اما سفر را پایان دادم.", buildMainMenu());
        return;
    }
    const { data: destRegion, error: drErr } = await supabase
        .from("regions")
        .select("*")
        .eq("id", destSpot.region_id)
        .maybeSingle();
    if (drErr || !destRegion) {
        console.error("arrive destRegion error:", drErr);
    }
    // متن سوخت برای راننده (اگر سوار وسیله باشد)
    let fuelInfoText = null;
    // آپدیت خود کاراکتر
    const { error: updErr } = await supabase
        .from("characters")
        .update({
        current_region_id: destSpot.region_id,
        current_spot_id: destSpot.id,
        pending_region_id: null,
        pending_spot_id: null,
        travel_started_at: null,
        travel_ready_at: null,
        travel_total_seconds: null,
        last_move_at: now.toISOString(),
    })
        .eq("id", char.id);
    if (updErr) {
        console.error("arrive update char error:", updErr);
    }
    // Region قبلی را لود کنیم برای کیک
    let prevRegion = null;
    if (prevRegionId) {
        const { data: pr, error: prErr } = await supabase
            .from("regions")
            .select("*")
            .eq("id", prevRegionId)
            .maybeSingle();
        if (prErr)
            console.error("load prevRegion error:", prErr);
        prevRegion = pr !== null && pr !== void 0 ? pr : null;
    }
    // کیک از گروه قبلی برای خود کاراکتر
    if (prevRegion && prevRegion.telegram_chat_id) {
        try {
            await ctx.api.banChatMember(prevRegion.telegram_chat_id, ctx.from.id, {
                until_date: Math.floor(Date.now() / 1000) + 30,
            });
            await ctx.api.unbanChatMember(prevRegion.telegram_chat_id, ctx.from.id, {
                only_if_banned: true,
            });
        }
        catch (e) {
            console.warn("kick from previous region failed:", e);
        }
    }
    // دعوت‌نامه‌ی گروه مقصد (فقط اگر ریجن عوض شده)
    let inviteUrl = null;
    if (destRegion &&
        destRegion.telegram_chat_id &&
        prevRegionId &&
        prevRegionId !== destRegion.id) {
        try {
            const link = await ctx.api.createChatInviteLink(destRegion.telegram_chat_id, {
                name: `Pathweaver-${Date.now()}`,
            });
            inviteUrl = link.invite_link;
        }
        catch (e) {
            console.error("createChatInviteLink error:", e);
        }
    }
    // اگر راننده‌ی یک وسیله هستی، مسافرهایت را هم جابه‌جا کن + سوخت کم کن
    if (char.riding_vehicle_id) {
        try {
            const { data: vehicle, error: vehErr } = await supabase
                .from("vehicles")
                .select("id, owner_char_id, title, fuel_percent, current_region_id, current_spot_id")
                .eq("id", char.riding_vehicle_id)
                .maybeSingle();
            if (!vehErr && vehicle && vehicle.owner_char_id === char.id) {
                // راننده‌ای
                // محاسبه زمان رانندگی از edge
                let driveSeconds = 0;
                if (fromSpotId) {
                    const { data: edge, error: edgeErr } = await supabase
                        .from("edges")
                        .select("drive_seconds, travel_seconds")
                        .eq("from_spot_id", fromSpotId)
                        .eq("to_spot_id", destSpot.id)
                        .maybeSingle();
                    if (!edgeErr && edge) {
                        driveSeconds = (_e = (_d = edge.drive_seconds) !== null && _d !== void 0 ? _d : edge.travel_seconds) !== null && _e !== void 0 ? _e : 0;
                    }
                }
                const fuelBefore = Number((_f = vehicle.fuel_percent) !== null && _f !== void 0 ? _f : 0);
                const usagePercent = (0, travel_vehicles_2.computeFuelUsagePercent)(driveSeconds);
                const fuelAfter = Math.max(0, fuelBefore - usagePercent);
                // آپدیت خود وسیله
                const { error: vehUpdateErr } = await supabase
                    .from("vehicles")
                    .update({
                    current_region_id: destSpot.region_id,
                    current_spot_id: destSpot.id,
                    fuel_percent: fuelAfter,
                })
                    .eq("id", vehicle.id);
                if (vehUpdateErr) {
                    console.error("group arrive: vehicle update error:", vehUpdateErr);
                }
                else {
                    // لاگ حرکت وسیله
                    const { error: moveErr } = await supabase.from("vehicle_moves").insert({
                        vehicle_id: vehicle.id,
                        from_spot_id: fromSpotId,
                        to_spot_id: destSpot.id,
                        mode: "drive",
                    });
                    if (moveErr) {
                        console.error("group arrive: log vehicle move error:", moveErr);
                    }
                    fuelInfoText = `⛽ سوخت وسیله‌ات حالا حدود ${fuelAfter.toFixed(1)}٪ است.`;
                }
                // مسافرها
                const { data: passengerRows, error: passErr } = await supabase
                    .from("vehicle_passengers")
                    .select("character_id")
                    .eq("vehicle_id", vehicle.id);
                if (!passErr && passengerRows && passengerRows.length > 0) {
                    const passengerIds = passengerRows.map((r) => r.character_id);
                    const { data: passengerChars, error: pcErr } = await supabase
                        .from("characters")
                        .select("id, tg_id, char_name")
                        .in("id", passengerIds);
                    if (!pcErr && passengerChars && passengerChars.length > 0) {
                        // لوکیشن و سفرشان را پایان بده
                        const { error: updPassengersErr } = await supabase
                            .from("characters")
                            .update({
                            current_region_id: destSpot.region_id,
                            current_spot_id: destSpot.id,
                            pending_region_id: null,
                            pending_spot_id: null,
                            travel_started_at: null,
                            travel_ready_at: null,
                            travel_total_seconds: null,
                            last_move_at: now.toISOString(),
                        })
                            .in("id", passengerChars.map((p) => p.id));
                        if (updPassengersErr) {
                            console.error("group arrive: update passengers error:", updPassengersErr);
                        }
                        else {
                            // اگر ریجن عوض شده، از گروه قبلی کیک‌شان کن
                            if (prevRegion &&
                                prevRegion.telegram_chat_id &&
                                destRegion &&
                                prevRegionId !== destRegion.id) {
                                for (const p of passengerChars) {
                                    if (!p.tg_id)
                                        continue;
                                    try {
                                        await ctx.api.banChatMember(prevRegion.telegram_chat_id, p.tg_id, {
                                            until_date: Math.floor(Date.now() / 1000) + 30,
                                        });
                                        await ctx.api.unbanChatMember(prevRegion.telegram_chat_id, p.tg_id, {
                                            only_if_banned: true,
                                        });
                                    }
                                    catch (e) {
                                        console.warn("group arrive: kick passenger failed:", e);
                                    }
                                }
                            }
                            // اگر ریجن عوض شده و لینک داریم، برای همه‌ی مسافرها هم بفرست
                            if (inviteUrl) {
                                const groupKb = new grammy_1.InlineKeyboard().url("🚪 ورود به مکان جدید", inviteUrl);
                                for (const p of passengerChars) {
                                    if (!p.tg_id)
                                        continue;
                                    try {
                                        await ctx.api.sendMessage(p.tg_id, `با ${(_g = char.char_name) !== null && _g !== void 0 ? _g : "راننده"} به «${(_h = destRegion === null || destRegion === void 0 ? void 0 : destRegion.title) !== null && _h !== void 0 ? _h : "منطقه‌ی جدید"} / ${destSpot.title}» رسیدی.\n` + "برای ورود به مکان جدید، روی دکمه زیر بزن:", { reply_markup: groupKb });
                                    }
                                    catch (e) {
                                        console.error("group arrive: notify passenger error:", e);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        catch (e) {
            console.error("group arrive logic failed:", e);
        }
    }
    // پیام برای خود کاراکتر
    const kb = new grammy_1.InlineKeyboard();
    if (inviteUrl) {
        kb.url("🚪 ورود به مکان جدید", inviteUrl).row();
    }
    kb.text("🧭 مسیر های من", "paths:open").row().text("🏠 منوی اصلی", "ui:home");
    const baseText = `به «${(_j = destRegion === null || destRegion === void 0 ? void 0 : destRegion.title) !== null && _j !== void 0 ? _j : "منطقه‌ی جدید"} / ${destSpot.title}» رسیدی.\n` +
        "هم‌اکنون مکان جدید در برابر تو باز شده است.";
    const finalText = fuelInfoText ? `${baseText}\n\n${fuelInfoText}` : baseText;
    await sendScreen(ctx, finalText, kb);
}
// --- نقشه سریع من ---
async function showQuickMap(ctx) {
    var _a;
    if (!ctx.from)
        return;
    if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private")
        return;
    const { supabase } = ctx.services;
    const char = await ensureCharacterFor(ctx, ctx.from.id);
    if (!char)
        return;
    if (!char.current_region_id || !char.current_spot_id) {
        await sendScreen(ctx, "هنوز در هیچ Region / Spotـی ثبت نشده‌ای.\n" +
            "ارباب باید در یکی از گروه‌ها روی پیامت ریپلای کند و «ثبت پلیر» را بفرستد.", buildMainMenu());
        return;
    }
    const { data: region, error: regErr } = await supabase
        .from("regions")
        .select("*")
        .eq("id", char.current_region_id)
        .maybeSingle();
    const { data: spot, error: spotErr } = await supabase
        .from("spots")
        .select("*")
        .eq("id", char.current_spot_id)
        .maybeSingle();
    if (regErr || spotErr || !region || !spot) {
        console.error("showQuickMap region/spot error:", regErr || spotErr);
        await sendScreen(ctx, "در خواندن موقعیت فعلی‌ات مشکلی پیش آمد.", buildMainMenu());
        return;
    }
    let vehicleTitle = null;
    if (char.riding_vehicle_id) {
        const { data: vehicle, error: vehErr } = await supabase
            .from("vehicles")
            .select("id, title")
            .eq("id", char.riding_vehicle_id)
            .maybeSingle();
        if (!vehErr && vehicle) {
            vehicleTitle = vehicle.title;
        }
    }
    let text = `📍 موقعیت فعلی‌ات در اکلیس:\n` +
        `Region: ${region.title}\n` +
        `Spot: ${spot.title}\n`;
    if (char.clan_name) {
        text += `خاندان: ${char.clan_name}\n`;
    }
    if (vehicleTitle) {
        text += `\n🚗 وضعیت: سوار بر «${vehicleTitle}» هستی.`;
    }
    else {
        text += `\n🚶 وضعیت: پیاده‌ای.`;
    }
    text += `\n\nبرای دیدن مسیرهای فعلی از «🧭 مسیر های من» استفاده کن.`;
    await sendScreen(ctx, text, buildMainMenu());
}
// --- /regplayer در گروه: ثبت پلیر روی اولین Spot ---
async function handleRegPlayer(ctx) {
    var _a, _b;
    if (!ctx.from)
        return;
    if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) === "private") {
        await ctx.reply("این دستور باید داخل گروه Region استفاده شود.");
        return;
    }
    if (!ctx.chat) {
        return;
    }
    if (ctx.from.id !== config_1.MASTER_ID) {
        await ctx.reply("🥷🏻 فقط ارباب من می‌تواند از این دستور استفاده کند، حدت را بدان.");
        return;
    }
    if (!((_b = ctx.message) === null || _b === void 0 ? void 0 : _b.reply_to_message) || !ctx.message.reply_to_message.from) {
        await ctx.reply("باید روی پیام بازیکن ریپلای کنی و بعد /regplayer را بفرستی.");
        return;
    }
    const target = ctx.message.reply_to_message.from;
    const chat = ctx.chat;
    const { supabase } = ctx.services;
    const { data: region, error: regErr } = await supabase
        .from("regions")
        .select("*")
        .eq("telegram_chat_id", chat.id)
        .maybeSingle();
    if (regErr || !region) {
        await ctx.reply("این گروه هنوز به عنوان Region ثبت نشده. اول /worldadmin را استفاده کن.");
        return;
    }
    const { data: firstSpot, error: spotErr } = await supabase
        .from("spots")
        .select("*")
        .eq("region_id", region.id)
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (spotErr || !firstSpot) {
        await ctx.reply("برای این Region هنوز هیچ Spotی تعریف نشده. در Supabase حداقل یک Spot بساز.");
        return;
    }
    const { data: char, error: charErr } = await supabase
        .from("characters")
        .select("*")
        .eq("tg_id", target.id)
        .maybeSingle();
    let charId = null;
    if (charErr) {
        console.error("regplayer char select error:", charErr);
        await ctx.reply("در خواندن اطلاعات بازیکن مشکلی پیش آمد.");
        return;
    }
    if (char) {
        const { error: updErr } = await supabase
            .from("characters")
            .update({
            current_region_id: region.id,
            current_spot_id: firstSpot.id,
            pending_region_id: null,
            pending_spot_id: null,
            travel_ready_at: null,
            travel_total_seconds: null,
            travel_started_at: null,
        })
            .eq("id", char.id);
        if (updErr) {
            console.error("regplayer char update error:", updErr);
            await ctx.reply("در ثبت موقعیت بازیکن مشکلی پیش آمد.");
            return;
        }
        charId = char.id;
    }
    else {
        const { data: ins, error: insErr } = await supabase
            .from("characters")
            .insert({
            tg_id: target.id,
            char_name: target.first_name,
            clan_name: null,
            current_region_id: region.id,
            current_spot_id: firstSpot.id,
        })
            .select("*")
            .maybeSingle();
        if (insErr || !ins) {
            console.error("regplayer char insert error:", insErr);
            await ctx.reply("در ساخت شخصیت جدید مشکلی پیش آمد.");
            return;
        }
        charId = ins.id;
    }
    await ctx.reply(`پلیر ثبت شد ✅\n` +
        `کاربر: ${target.first_name}\n` +
        `مکان اولیه: ${region.title} / ${firstSpot.title}`);
}
async function showVehicleDash(ctx) {
    var _a, _b, _c;
    if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private" || !ctx.from)
        return;
    const { supabase } = ctx.services;
    const char = await ensureCharacterFor(ctx, ctx.from.id);
    if (!char || !char.riding_vehicle_id) {
        await sendScreen(ctx, "الان سوار هیچ وسیله‌ای نیستی.", buildMainMenu());
        return;
    }
    const { data: vehicle, error: vehErr } = await supabase
        .from("vehicles")
        .select("id, title, capacity, fuel_percent, passenger_locked")
        .eq("id", char.riding_vehicle_id)
        .maybeSingle();
    if (vehErr || !vehicle) {
        console.error("veh:dash vehicle error:", vehErr);
        await sendScreen(ctx, "وسیله‌ات پیدا نشد.", buildMainMenu());
        return;
    }
    const { driverCount, passengerCount, total } = await (0, travel_vehicles_1.getVehiclePassengerCount)(ctx, vehicle.id);
    const cap = (_b = vehicle.capacity) !== null && _b !== void 0 ? _b : 1;
    const fuel = typeof vehicle.fuel_percent === "number"
        ? `${vehicle.fuel_percent.toFixed(1)}٪`
        : "نامشخص";
    const locked = !!vehicle.passenger_locked;
    let text = "";
    text += `🎛 صفحه پشت فرمون\n\n`;
    text += `وسیله: ${(_c = vehicle.title) !== null && _c !== void 0 ? _c : "وسیله"} (#${vehicle.id})\n`;
    text += `سوخت: ${fuel}\n`;
    text += `سرنشین‌ها: ${total}/${cap}\n`;
    text += `- راننده: ${driverCount}\n`;
    text += `- مسافر: ${passengerCount}\n`;
    text += `وضعیت مسافران: ${locked ? "🔒 قفل" : "🔓 باز"}\n`;
    const kb = new grammy_1.InlineKeyboard();
    kb.text(locked ? "🔓 باز کردن درِ مسافران" : "🔒 قفل کردن مسافران", `veh:lockdash:${vehicle.id}`).row();
    // ⛽ اگر اینجا چاه فلوکس هست، دکمه سوخت‌گیری بده
    if (char.current_region_id && char.current_spot_id) {
        const wellRes = await ctx.services.db.hasFluxWell(char.current_region_id, char.current_spot_id);
        const hasFlux = wellRes.ok && !!wellRes.data;
        if (!wellRes.ok)
            console.error("veh:dash hasFluxWell error:", wellRes.error);
        if (hasFlux)
            kb.text("⛽ سوخت‌گیری", "flux:fuel").row();
    }
    kb.text("🔙 بازگشت", "travel:home");
    await sendScreen(ctx, text, kb);
}
// --- رجیستر کردن فیچر سفر ---
function registerTravelFeature(bot) {
    // منوی وضعیت سفر
    bot.command("path", showTravelHome);
    bot.hears("🧭 مسیر های من", showTravelHome);
    bot.callbackQuery("paths:open", async (ctx) => {
        var _a;
        await ctx.answerCallbackQuery().catch(() => { });
        if (!ctx.from || ((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private")
            return;
        const { supabase } = ctx.services;
        const { data: char } = await supabase
            .from("characters")
            .select("*")
            .eq("tg_id", ctx.from.id)
            .maybeSingle();
        if (char && isTraveling(char)) {
            await showTravelInProgress(ctx, char);
            return;
        }
        await openPaths(ctx);
    });
    // برگشت به صفحه وضعیت (پیاده / سوار)
    bot.callbackQuery("travel:home", async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => { });
        await showTravelHome(ctx);
    });
    // لیست مسیرها
    bot.callbackQuery("paths:list", async (ctx) => {
        var _a;
        await ctx.answerCallbackQuery().catch(() => { });
        if (!ctx.from || ((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private")
            return;
        const { supabase } = ctx.services;
        const { data: char } = await supabase
            .from("characters")
            .select("*")
            .eq("tg_id", ctx.from.id)
            .maybeSingle();
        if (char && isTraveling(char)) {
            await showTravelInProgress(ctx, char);
            return;
        }
        await openPaths(ctx);
    });
    // کلیک روی مسیر پیاده
    bot.callbackQuery(/go:(\d+)/, async (ctx) => {
        var _a;
        if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private") {
            await ctx.answerCallbackQuery().catch(() => { });
            return;
        }
        const edgeId = Number(ctx.match[1]);
        await startWalkTravel(ctx, edgeId);
    });
    // کلیک روی مسیر رانندگی
    bot.callbackQuery(/^veh:go:(\d+):(\d+)$/, async (ctx) => {
        var _a;
        if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private") {
            await ctx.answerCallbackQuery().catch(() => { });
            return;
        }
        const edgeId = Number(ctx.match[1]);
        const vehicleId = Number(ctx.match[2]);
        await startDriveTravel(ctx, edgeId, vehicleId);
    });
    // رسیدم؟
    bot.command("arrive", handleArrive);
    bot.callbackQuery("travel:arrive", async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => { });
        await handleArrive(ctx);
    });
    // لغو مسیر
    bot.callbackQuery("travel:cancel", async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => { });
        await handleCancelTravel(ctx);
    });
    // نقشه سریع من
    bot.command("mymap", showQuickMap);
    bot.hears("🗺 نقشه سریع من", showQuickMap);
    bot.callbackQuery("mymap:open", async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => { });
        await showQuickMap(ctx);
    });
    // صفحه پشت فرمون
    bot.callbackQuery("veh:dash", async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => { });
        await showVehicleDash(ctx);
    });
    bot.callbackQuery(/^veh:lockdash:(\d+)$/, async (ctx) => {
        var _a;
        await ctx.answerCallbackQuery().catch(() => { });
        if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private" || !ctx.from)
            return;
        const vehicleId = Number(ctx.match[1]);
        const { supabase } = ctx.services;
        const char = await ensureCharacterFor(ctx, ctx.from.id);
        if (!char)
            return;
        const { data: vehicle, error: vehErr } = await supabase
            .from("vehicles")
            .select("id, owner_char_id, passenger_locked")
            .eq("id", vehicleId)
            .maybeSingle();
        if (vehErr || !vehicle) {
            console.error("veh:lockdash vehicle error:", vehErr);
            await sendScreen(ctx, "وسیله‌ات پیدا نشد.", buildMainMenu());
            return;
        }
        if (vehicle.owner_char_id !== char.id) {
            await sendScreen(ctx, "فقط صاحب وسیله می‌تواند درهای مسافران را قفل یا باز کند.", buildMainMenu());
            return;
        }
        const newLocked = !vehicle.passenger_locked;
        const { error: updErr } = await supabase
            .from("vehicles")
            .update({ passenger_locked: newLocked })
            .eq("id", vehicle.id);
        if (updErr) {
            console.error("veh:lockdash update error:", updErr);
            await ctx
                .answerCallbackQuery({
                text: "در تغییر وضعیت قفل مشکلی پیش آمد.",
                show_alert: true,
            })
                .catch(() => { });
            return;
        }
        await showVehicleDash(ctx);
    });
    // ثبت پلیر در Region
    bot.command("regplayer", handleRegPlayer);
    // صفحه «روش‌های سوار شدن» از منوی پیاده
    bot.callbackQuery("ride:home", async (ctx) => {
        var _a;
        await ctx.answerCallbackQuery().catch(() => { });
        if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private" || !ctx.from)
            return;
        const { supabase } = ctx.services;
        const char = await ensureCharacterFor(ctx, ctx.from.id);
        if (!char)
            return;
        if (isTraveling(char)) {
            await showTravelInProgress(ctx, char);
            return;
        }
        const { data: vehicles, error: vehErr } = await supabase
            .from("vehicles")
            .select("id, title")
            .eq("owner_char_id", char.id);
        if (vehErr) {
            console.error("ride:home vehicles error:", vehErr);
        }
        let text = "راه‌های سوار شدنتون:\n\n";
        const kb = new grammy_1.InlineKeyboard();
        kb.text("🚕 سوار شدن", "ride:menu").row();
        if (vehicles && vehicles.length > 0) {
            kb.text("🚗 سواری‌های من", "veh:my").row();
            text += "• «سوار شدن» → روی وسیله‌های حاضر در این نقطه می‌توانی مسافر شوی.\n";
            text +=
                "• «سواری‌های من» → وسیله‌های خودت را می‌بینی و اگر در همین نقطه باشند می‌توانی راننده‌ی آن‌ها شوی.\n";
        }
        else {
            text +=
                "فعلاً وسیله‌ای به نامت ثبت نشده، اما اگر این‌جا وسیله‌ای حضور داشته باشد می‌توانی مسافر شوی.\n";
        }
        kb.text("🔙 بازگشت", "travel:home");
        await sendScreen(ctx, text, kb);
    });
}
