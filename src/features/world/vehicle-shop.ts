import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

type SessionData = MyContext["session"] & {
  vehicleWizard?: {
    mode: "create";
    step: "ask_char_code" | "ask_type" | "ask_capacity" | "ask_title" | "confirm";
    targetCharId?: number;
    targetCharCode?: string;
    targetCharName?: string | null;
    targetClanName?: string | null;
    vehicleType?: string;
    capacity?: number;
    title?: string;
  };
};

/** Helper: load shop_settings */
async function getShopChatId(ctx: MyContext): Promise<number | null> {
  const { supabase } = ctx.services;
  const { data, error } = await supabase
    .from("shop_settings")
    .select("shop_chat_id")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("getShopChatId error:", error);
    return null;
  }
  return data?.shop_chat_id ?? null;
}

/** Helper: load bank_settings */
async function getBankChatId(ctx: MyContext): Promise<number | null> {
  const { supabase } = ctx.services;
  const { data, error } = await supabase
    .from("bank_settings")
    .select("bank_chat_id")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("getBankChatId error:", error);
    return null;
  }
  return data?.bank_chat_id ?? null;
}

/** Helper: is master */
function isMaster(ctx: MyContext): boolean {
  return !!ctx.from && ctx.from.id === MASTER_ID;
}

/** Helper: is in group */
function isGroup(ctx: MyContext): boolean {
  return !!ctx.chat && ctx.chat.type !== "private";
}

/** Helper: check shop admin */
async function isShopAdminOrMaster(ctx: MyContext): Promise<boolean> {
  if (isMaster(ctx)) return true;
  const { supabase } = ctx.services;
  if (!ctx.from) return false;
  const { data, error } = await supabase
    .from("shop_admins")
    .select("id")
    .eq("tg_id", ctx.from.id)
    .maybeSingle();

  if (error) {
    console.error("isShopAdmin error:", error);
    return false;
  }
  return !!data;
}

/** Helper: safe delete message */
async function safeDeleteMessage(ctx: MyContext) {
  try {
    if (ctx.message) {
      await ctx.deleteMessage();
    }
  } catch (e) {
    console.warn("vehicle-shop: failed to delete message:", e);
  }
}

/** Helper: send DM */
async function sendDM(ctx: MyContext, userId: number, text: string, kb?: InlineKeyboard) {
  try {
    await ctx.api.sendMessage(userId, text, {
      reply_markup: kb,
    });
  } catch (e) {
    console.error("sendDM failed:", e);
  }
}

export function registerWorldVehicleShop(bot: Bot<MyContext>): void {
  //
  // ثبت / حذف گروه بانک
  //
  bot.hears("ثبت گروه بانک", async (ctx) => {
    if (!isMaster(ctx) || !isGroup(ctx)) return;

    const { supabase } = ctx.services;
    const chatId = ctx.chat!.id;

    await safeDeleteMessage(ctx);

    const { error } = await supabase
      .from("bank_settings")
      .upsert({ id: 1, bank_chat_id: chatId }, { onConflict: "id" });

    if (error) {
      console.error("set bank_chat_id error:", error);
      await ctx.reply("در ثبت گروه بانک مشکلی پیش آمد.");
      return;
    }

    await ctx.reply(
      "🏦 این گروه به عنوان «گروه مدیریت بانک اکلیس» ثبت شد.\n" +
        "تراکنش‌های فلوکس از این به بعد به اینجا ارسال می‌شوند."
    );
  });

  bot.hears("حذف گروه بانک", async (ctx) => {
    if (!isMaster(ctx) || !isGroup(ctx)) return;

    const { supabase } = ctx.services;
    const chatId = ctx.chat!.id;

    await safeDeleteMessage(ctx);

    const currentBankId = await getBankChatId(ctx);
    if (currentBankId !== chatId) {
      await ctx.reply("این گروه در حال حاضر به عنوان گروه بانک ثبت نشده است.");
      return;
    }

    const { error } = await supabase
      .from("bank_settings")
      .update({ bank_chat_id: null })
      .eq("id", 1);

    if (error) {
      console.error("clear bank_chat_id error:", error);
      await ctx.reply("در حذف گروه بانک مشکلی پیش آمد.");
      return;
    }

    await ctx.reply(
      "🏦 این گروه دیگر به عنوان گروه بانک شناخته نمی‌شود.\n" +
        "تا ثبت دوباره بانک، تراکنش جدیدی ارسال نخواهد شد."
    );
  });

  //
  // ثبت / حذف گروه شاپ
  //
  bot.hears("ثبت گروه شاپ", async (ctx) => {
    if (!isMaster(ctx) || !isGroup(ctx)) return;

    const { supabase } = ctx.services;
    const chatId = ctx.chat!.id;

    await safeDeleteMessage(ctx);

    const { error } = await supabase
      .from("shop_settings")
      .upsert({ id: 1, shop_chat_id: chatId }, { onConflict: "id" });

    if (error) {
      console.error("set shop_chat_id error:", error);
      await ctx.reply("در ثبت گروه شاپ مشکلی پیش آمد.");
      return;
    }

    await ctx.reply(
      "🛒 این گروه به عنوان «گروه شاپ وسایل نقلیه» ثبت شد.\n" +
        "از این پس فقط دستورهای مخصوص شاپ در اینجا معتبرند."
    );
  });

  bot.hears("حذف گروه شاپ", async (ctx) => {
    if (!isMaster(ctx) || !isGroup(ctx)) return;

    const { supabase } = ctx.services;
    const chatId = ctx.chat!.id;

    await safeDeleteMessage(ctx);

    const currentShopId = await getShopChatId(ctx);
    if (currentShopId !== chatId) {
      await ctx.reply("این گروه در حال حاضر به عنوان گروه شاپ ثبت نشده است.");
      return;
    }

    const { error } = await supabase
      .from("shop_settings")
      .update({ shop_chat_id: null })
      .eq("id", 1);

    if (error) {
      console.error("clear shop_chat_id error:", error);
      await ctx.reply("در حذف گروه شاپ مشکلی پیش آمد.");
      return;
    }

    await ctx.reply("🛒 این گروه دیگر به عنوان گروه شاپ شناخته نمی‌شود.");
  });

  //
  // ثبت / حذف ادمین شاپ (با ریپلای)
  //
  bot.hears("ثبت ادمین شاپ", async (ctx) => {
    if (!isMaster(ctx) || !isGroup(ctx)) return;

    const { supabase } = ctx.services;
    const chatId = ctx.chat!.id;
    const shopId = await getShopChatId(ctx);

    await safeDeleteMessage(ctx);

    if (shopId === null || shopId !== chatId) {
      await ctx.reply("این گروه شاپ ثبت‌شده نیست. ابتدا «ثبت گروه شاپ» را بزن.");
      return;
    }

    const reply = ctx.message?.reply_to_message;
    if (!reply || !reply.from) {
      await ctx.reply("باید این دستور را روی پیام فرد مورد نظر ریپلای کنی.");
      return;
    }

    const { error } = await supabase
      .from("shop_admins")
      .upsert({ tg_id: reply.from.id });

    if (error) {
      console.error("add shop_admin error:", error);
      await ctx.reply("در ثبت ادمین شاپ مشکلی پیش آمد.");
      return;
    }

    await ctx.reply(
      `✅ کاربر [${reply.from.first_name}] به عنوان ادمین شاپ ثبت شد.`
    );
  });

  bot.hears("حذف ادمین شاپ", async (ctx) => {
    if (!isMaster(ctx) || !isGroup(ctx)) return;

    const { supabase } = ctx.services;
    const chatId = ctx.chat!.id;
    const shopId = await getShopChatId(ctx);

    await safeDeleteMessage(ctx);

    if (shopId === null || shopId !== chatId) {
      await ctx.reply("این گروه شاپ ثبت‌شده نیست.");
      return;
    }

    const reply = ctx.message?.reply_to_message;
    if (!reply || !reply.from) {
      await ctx.reply("باید این دستور را روی پیام فرد مورد نظر ریپلای کنی.");
      return;
    }

    const { error } = await supabase
      .from("shop_admins")
      .delete()
      .eq("tg_id", reply.from.id);

    if (error) {
      console.error("remove shop_admin error:", error);
      await ctx.reply("در حذف ادمین شاپ مشکلی پیش آمد.");
      return;
    }

    await ctx.reply(
      `✅ کاربر [${reply.from.first_name}] از ادمین‌های شاپ حذف شد.`
    );
  });

  //
  // ثبت سراسری قیمت فلوکس
  //
  bot.hears("ثبت سراسری قیمت فلوکس", async (ctx) => {
    if (!isMaster(ctx)) return;

    await safeDeleteMessage(ctx);

    const kb = new InlineKeyboard().text(
      "🧪 تنظیم قیمت پایه فلوکس",
      "econ:fluxprice:start"
    );

    await sendDM(
      ctx,
      MASTER_ID,
      "🧪 ثبت سراسری قیمت فلوکس\n" +
        "یک عدد بفرست که قیمت پایه فلوکس را مشخص کند (Solen برای هر ۱٪ باک).\n" +
        "مثال: اگر ۵ بفرستی، پر کردن ۲۰٪ باک = ۱۰۰ Solen.",
      kb
    );
  });

  bot.callbackQuery("econ:fluxprice:start", async (ctx) => {
    (ctx.session as SessionData).vehicleWizard = undefined;
    // برای سادگی، از همین SessionData استفاده می‌کنیم یک فلگ ساده ست کنیم:
    (ctx.session as any).awaitingFluxPrice = true;

    await ctx.editMessageText(
      "🧪 قیمت پایه فلوکس:\n" +
        "یک عدد بفرست (Solen برای هر ۱٪ باک).\n" +
        "مثال: 5 یا 7.5",
    );
  });

  //
  // ثبت وسیله – شروع از گروه شاپ، ادامه در پی‌وی ادمین
  //
  bot.hears("ثبت وسیله", async (ctx) => {
    if (!isGroup(ctx)) return;

    const shopId = await getShopChatId(ctx);
    if (!shopId || ctx.chat!.id !== shopId) return;

    if (!(await isShopAdminOrMaster(ctx))) {
      await ctx.reply("این دستور فقط برای ارباب یا ادمین‌های شاپ فعال است.");
      return;
    }

    await safeDeleteMessage(ctx);

    const adminId = ctx.from!.id;
    const s = (ctx.session as SessionData);
    s.vehicleWizard = {
      mode: "create",
      step: "ask_char_code",
    };

    await sendDM(
      ctx,
      adminId,
      "🚗 ثبت وسیله جدید\n" +
        "ابتدا آیدی شخصی کاراکتر (char_code) را بفرست.\n" +
        "مثال: NECRO_ASHEN_01"
    );
  });

  //
  // Wizard ثبت وسیله در پی‌وی ادمین شاپ
  //
  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    const s = (ctx.session as SessionData);
    const { supabase } = ctx.services;

    // هندل ثبت قیمت فلوکس
    if ((ctx.session as any).awaitingFluxPrice && isMaster(ctx)) {
      const raw = ctx.message.text.trim().replace(",", ".");
      const value = Number(raw);
      if (!isFinite(value) || value <= 0) {
        await ctx.reply("عدد نامعتبر. یک مقدار مثبت بفرست.");
        return;
      }

      const { error } = await supabase
        .from("economy_settings")
        .upsert(
          { key: "flux_base_price", value_json: { per_percent: value } },
          { onConflict: "key" }
        );

      if (error) {
        console.error("set flux_base_price error:", error);
        await ctx.reply("در ذخیره قیمت فلوکس مشکلی پیش آمد.");
        return;
      }

      (ctx.session as any).awaitingFluxPrice = false;
      await ctx.reply(
        `✅ قیمت پایه فلوکس روی ${value} Solen برای هر ۱٪ باک تنظیم شد.`
      );
      return;
    }

    if (!s.vehicleWizard || s.vehicleWizard.mode !== "create") return;

    const step = s.vehicleWizard.step;
    const text = ctx.message.text.trim();

    if (step === "ask_char_code") {
      // پیدا کردن کاراکتر با char_code
      const { data: char, error } = await supabase
        .from("characters")
        .select("id, char_name, clan_name, char_code, current_region_id, current_spot_id")
        .eq("char_code", text)
        .maybeSingle();

      if (error) {
        console.error("find character by char_code error:", error);
        await ctx.reply("در جستجوی کاراکتر مشکلی پیش آمد.");
        return;
      }
      if (!char) {
        await ctx.reply(
          "چنین کاراکتری پیدا نشد. مطمئنی char_code را درست نوشتی؟"
        );
        return;
      }

      s.vehicleWizard.targetCharId = char.id;
      s.vehicleWizard.targetCharCode = char.char_code;
      s.vehicleWizard.targetCharName = char.char_name;
      s.vehicleWizard.targetClanName = char.clan_name;
      s.vehicleWizard.step = "ask_type";

      await ctx.reply(
        `کاراکتر پیدا شد:\n` +
          `• نام: ${char.char_name || "—"}\n` +
          `• کد: ${char.char_code}\n` +
          `• خاندان: ${char.clan_name || "—"}\n\n` +
          "حالا نوع وسیله را بفرست (مثال: car, motor, cart ...)."
      );
      return;
    }

    if (step === "ask_type") {
      s.vehicleWizard.vehicleType = text;
      s.vehicleWizard.step = "ask_capacity";
      await ctx.reply(
        "ظرفیت سرنشین را بنویس (چند نفر می‌توانند سوار شوند؟ عدد صحیح)."
      );
      return;
    }

    if (step === "ask_capacity") {
      const cap = Number(text);
      if (!Number.isInteger(cap) || cap < 0) {
        await ctx.reply("ظرفیت باید یک عدد صحیح صفر یا بیشتر باشد.");
        return;
      }
      s.vehicleWizard.capacity = cap;
      s.vehicleWizard.step = "ask_title";
      await ctx.reply("نام نمایش وسیله را بفرست (مثال: شبح نقره‌ای).");
      return;
    }

    if (step === "ask_title") {
      s.vehicleWizard.title = text;
      s.vehicleWizard.step = "confirm";

      const kb = new InlineKeyboard()
        .text("✅ تایید", "shop:vehicle:confirm")
        .text("❌ لغو", "shop:vehicle:cancel");

      const w = s.vehicleWizard;
      await ctx.reply(
        "🧾 خلاصه اطلاعات وسیله:\n" +
