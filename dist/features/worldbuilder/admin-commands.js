"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorldAdminCommands = registerWorldAdminCommands;
const grammy_1 = require("grammy");
const config_1 = require("../../core/config");
// فقط ارباب و فقط توی گروه
function isFromMasterInGroup(ctx) {
    if (!ctx.from)
        return false;
    if (ctx.from.id !== config_1.MASTER_ID)
        return false;
    if (!ctx.chat || ctx.chat.type === "private")
        return false;
    return true;
}
// گرفتن Region بر اساس chat_id گروه
async function getRegionForChat(ctx) {
    const { supabase } = ctx.services;
    if (!ctx.chat)
        return { region: null, errorText: "چتی پیدا نشد." };
    const chatId = ctx.chat.id;
    const { data: region, error } = await supabase
        .from("regions")
        .select("*")
        .eq("telegram_chat_id", chatId)
        .maybeSingle();
    if (error) {
        console.error("getRegionForChat error:", error);
        return {
            region: null,
            errorText: "در دسترسی به اطلاعات Region مشکلی پیش آمد.",
        };
    }
    if (!region) {
        return {
            region: null,
            errorText: "این گروه هنوز به عنوان Region ثبت نشده است.\n" +
                "اول در همین گروه /worldadmin را بفرست تا ثبت شود.",
        };
    }
    return { region, errorText: null };
}
// حذف پیام دستور در گروه، بدون سروصدا
async function safeDeleteMessage(ctx) {
    try {
        if (ctx.message) {
            await ctx.deleteMessage();
        }
    }
    catch (e) {
        console.warn("delete admin command message failed:", e);
    }
}
// فرستادن پیام به پی‌وی ارباب
async function sendToMaster(ctx, text, keyboard) {
    try {
        await ctx.api.sendMessage(config_1.MASTER_ID, text, {
            reply_markup: keyboard,
        });
    }
    catch (e) {
        console.error("sendToMaster failed:", e);
    }
}
function registerWorldAdminCommands(bot) {
    // 🧱 ساخت منطقه (Spot جدید داخل همین Region)
    bot.hears("ساخت منطقه", async (ctx) => {
        var _a;
        if (!isFromMasterInGroup(ctx)) {
            if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private") {
                await ctx.reply("🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون");
            }
            return;
        }
        await safeDeleteMessage(ctx);
        const { region, errorText } = await getRegionForChat(ctx);
        if (!region) {
            await sendToMaster(ctx, "دستور «ساخت منطقه» در گروهی زده شد که Region آن مشخص نیست.\n\n" +
                (errorText || ""));
            return;
        }
        const kb = new grammy_1.InlineKeyboard().text("📍 ساخت منطقه (Spot) جدید", `admin:addspot:${region.id}`);
        const clanText = region.clan_name ? `خاندان: ${region.clan_name}\n` : "خاندان: نامشخص\n";
        await sendToMaster(ctx, "🧱 ساخت منطقه جدید\n" +
            "───────────────\n" +
            `گروه: ${region.title}\n` +
            `region_id: ${region.id}\n` +
            clanText +
            "برای ساخت یک نقطه (Spot) جدید در این Region از دکمه زیر استفاده کن.\n" +
            "بعد از زدن دکمه، نام منطقه ازت پرسیده می‌شود.", kb);
    });
    /*
  // 🛣 ساخت مسیر (Edge) برای همین Region
    bot.hears("ساخت مسیر", async (ctx) => {
      if (!isFromMasterInGroup(ctx)) {
        if (ctx.chat?.type !== "private") {
          await ctx.reply("🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون");
        }
        return;
      }
  
      await safeDeleteMessage(ctx);
  
      const { region, errorText } = await getRegionForChat(ctx);
      if (!region) {
        await sendToMaster(
          ctx,
          "دستور «ساخت مسیر» در گروهی زده شد که Region آن مشخص نیست.\n\n" +
            (errorText || "")
        );
        return;
      }
  
      const kb = new InlineKeyboard().text(
        "🛣 شروع ساخت مسیر جدید",
        `admin:addedge:${region.id}`
      );
  
      await sendToMaster(
        ctx,
        "🛣 ساخت مسیر\n" +
          "───────────────\n" +
          `Region: ${region.title}\n` +
          `region_id: ${region.id}\n\n` +
          "با دکمه‌ی زیر وارد ویزارد ساخت Edge شو.\n" +
          "در آن‌جا مبدأ و مقصد، نوع مسیر (پیاده/سوار/راننده/حمل‌ونقل) و زمان سفر را انتخاب می‌کنی.",
        kb
      );
    });
  
    
  */
    // 🗑 حذف مسیر (Edge)
    bot.hears("حذف مسیر", async (ctx) => {
        var _a;
        if (!isFromMasterInGroup(ctx)) {
            if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private") {
                await ctx.reply("🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون");
            }
            return;
        }
        await safeDeleteMessage(ctx);
        const { region, errorText } = await getRegionForChat(ctx);
        if (!region) {
            await sendToMaster(ctx, "دستور «حذف مسیر» در گروهی زده شد که Region آن مشخص نیست.\n\n" +
                (errorText || ""));
            return;
        }
        const kb = new grammy_1.InlineKeyboard().text("🗑 انتخاب مسیر برای حذف", `admin:deledge:${region.id}`);
        await sendToMaster(ctx, "🗑 حذف مسیر\n" +
            "───────────────\n" +
            `Region: ${region.title}\n` +
            `region_id: ${region.id}\n\n` +
            "با دکمه‌ی زیر لیست Edgeهای مرتبط با این Region را می‌بینی و می‌توانی هرکدام را حذف کنی.", kb);
    });
    // 🗑 حذف منطقه (Spot + Edgeهای مربوطه)
    bot.hears("حذف منطقه", async (ctx) => {
        var _a;
        if (!isFromMasterInGroup(ctx)) {
            if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private") {
                await ctx.reply("🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون");
            }
            return;
        }
        await safeDeleteMessage(ctx);
        const { region, errorText } = await getRegionForChat(ctx);
        if (!region) {
            await sendToMaster(ctx, "دستور «حذف منطقه» در گروهی زده شد که Region آن مشخص نیست.\n\n" +
                (errorText || ""));
            return;
        }
        const kb = new grammy_1.InlineKeyboard().text("🗑 انتخاب منطقه برای حذف", `admin:delspot:${region.id}`);
        await sendToMaster(ctx, "🗑 حذف منطقه\n" +
            "───────────────\n" +
            `Region: ${region.title}\n` +
            `region_id: ${region.id}\n\n` +
            "با دکمه‌ی زیر لیست Spotهای این Region را می‌بینی و می‌توانی یکی را برای حذف انتخاب کنی.\n" +
            "با حذف یک Spot، تمام Edgeهای متصل به آن هم به‌صورت خودکار (به‌خاطر FK) حذف می‌شوند.", kb);
    });
    // ⚙️ تنظیمات ریجن (ورود به پنل کلی Region)
    bot.hears("تنظیمات ریجن", async (ctx) => {
        var _a;
        if (!isFromMasterInGroup(ctx)) {
            if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private") {
                await ctx.reply("🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون");
            }
            return;
        }
        await safeDeleteMessage(ctx);
        const { region, errorText } = await getRegionForChat(ctx);
        if (!region) {
            await sendToMaster(ctx, "دستور «تنظیمات ریجن» در گروهی زده شد که Region آن مشخص نیست.\n\n" +
                (errorText || ""));
            return;
        }
        const kb = new grammy_1.InlineKeyboard().text("⚙️ باز کردن پنل Region", `admin:openregion:${region.id}`);
        const clanText = region.clan_name || region.clan_name === ""
            ? `خاندان: ${region.clan_name || "هنوز تنظیم نشده"}\n`
            : "خاندان: نامشخص\n";
        await sendToMaster(ctx, "⚙️ تنظیمات Region\n" +
            "───────────────\n" +
            `نام: ${region.title}\n` +
            `chat_id: ${region.telegram_chat_id}\n` +
            `region_id: ${region.id}\n` +
            clanText +
            "با دکمه‌ی زیر می‌توانی پنل کامل Region را باز کنی:\n" +
            "ساخت/حذف Spot، ساخت/حذف Edge، قفل‌ها و غیره.", kb);
    });
    // 📜 لیست مسیرها (Edgeها) برای این Region
    bot.hears("لیست مسیرها", async (ctx) => {
        var _a;
        if (!isFromMasterInGroup(ctx)) {
            if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private") {
                await ctx.reply("🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون");
            }
            return;
        }
        await safeDeleteMessage(ctx);
        const { region, errorText } = await getRegionForChat(ctx);
        if (!region) {
            await sendToMaster(ctx, "دستور «لیست مسیرها» در گروهی زده شد که Region آن مشخص نیست.\n\n" +
                (errorText || ""));
            return;
        }
        const kb = new grammy_1.InlineKeyboard().text("📜 نمایش لیست مسیرها", `admin:listedges:${region.id}`);
        await sendToMaster(ctx, "📜 لیست مسیرها\n" +
            "───────────────\n" +
            `Region: ${region.title}\n` +
            `region_id: ${region.id}\n\n` +
            "با دکمه‌ی زیر لیست Edgeهای مرتبط با این Region را می‌بینی.\n" +
            "خود پنل لیست، جزئیات را برایت می‌نویسد.", kb);
    });
    // 📍 لیست مناطق (Spotها) برای این Region
    bot.hears("لیست مناطق", async (ctx) => {
        var _a;
        if (!isFromMasterInGroup(ctx)) {
            if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private") {
                await ctx.reply("🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون");
            }
            return;
        }
        await safeDeleteMessage(ctx);
        const { region, errorText } = await getRegionForChat(ctx);
        if (!region) {
            await sendToMaster(ctx, "دستور «لیست مناطق» در گروهی زده شد که Region آن مشخص نیست.\n\n" +
                (errorText || ""));
            return;
        }
        const kb = new grammy_1.InlineKeyboard().text("📍 نمایش لیست مناطق", `admin:listspots:${region.id}`);
        await sendToMaster(ctx, "📍 لیست مناطق\n" +
            "───────────────\n" +
            `Region: ${region.title}\n` +
            `region_id: ${region.id}\n\n` +
            "با دکمه‌ی زیر لیست Spotهای این Region را می‌بینی.\n" +
            "از همان پنل هم می‌توانی برای ویرایش/حذف استفاده کنی.", kb);
    });
}
