import { Bot } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

type SessionData = MyContext["session"] & {
  vehicleWizard?: {
    mode: "create";
    chatId: number;              // چتی که ویزارد توش فعاله (گروه شاپ)
    adminId: number;             // کی داره ویزارد رو می‌ره
    step: "ask_char_code" | "ask_type" | "ask_capacity" | "ask_title" | "confirm";
    targetCharId?: number;
    targetCharCode?: string;
    targetCharName?: string | null;
    targetClanName?: string | null;
    vehicleType?: string;
    capacity?: number;
    title?: string;
  };
  awaitingFluxPrice?: boolean;   // برای ثبت سراسری قیمت فلوکس
};

function isMaster(ctx: MyContext): boolean {
  return !!ctx.from && ctx.from.id === MASTER_ID;
}

function isGroup(ctx: MyContext): boolean {
  return !!ctx.chat && ctx.chat.type !== "private";
}

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

async function getCharacterByTg(ctx: MyContext) {
  const { supabase } = ctx.services;
  if (!ctx.from) return { char: null, errorText: "کاربر تلگرام نامشخص است." };

  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", ctx.from.id)
    .maybeSingle();

  if (error) {
    console.error("getCharacterByTg error:", error);
    return { char: null, errorText: "خطا در خواندن اطلاعات کاراکتر." };
  }
  if (!data) {
    return {
      char: null,
      errorText:
        "هنوز کاراکتر برایت ثبت نشده.\nبا دستور ثبت من / یا سیستم ثبت نام، اول کاراکترت را بساز.",
    };
  }
  return { char: data, errorText: null as string | null };
}

export function registerWorldVehicleShop(bot: Bot<MyContext>): void {
  //
  // 🏦 ثبت / حذف گروه بانک
  //
  bot.hears("ثبت گروه بانک", async (ctx) => {
    if (!isMaster(ctx) || !isGroup(ctx)) return;

    const { supabase } = ctx.services;
    const chatId = ctx.chat!.id;

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
        "تا ثبت دوباره بانک، تراکنش جدیدی ثبت نمی‌شود."
    );
  });

  //
  // 🛒 ثبت / حذف گروه شاپ
  //
  bot.hears("ثبت گروه شاپ", async (ctx) => {
    if (!isMaster(ctx) || !isGroup(ctx)) return;

    const { supabase } = ctx.services;
    const chatId = ctx.chat!.id;

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
  // 👤 ثبت / حذف ادمین شاپ (با ریپلای)
  //
  bot.hears("ثبت ادمین شاپ", async (ctx) => {
    if (!isMaster(ctx) || !isGroup(ctx)) return;

    const { supabase } = ctx.services;
    const chatId = ctx.chat!.id;
    const shopId = await getShopChatId(ctx);

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
  // 🧪 ثبت سراسری قیمت فلوکس (در هر گروهی، ولی فقط برای ارباب)
  //
  bot.hears("ثبت سراسری قیمت فلوکس", async (ctx) => {
    if (!isMaster(ctx)) return;

    const s = ctx.session as SessionData;
    s.awaitingFluxPrice = true;

    await ctx.reply(
      "🧪 ثبت سراسری قیمت فلوکس\n" +
        "یک عدد بفرست که قیمت پایه فلوکس را مشخص کند (Solen برای هر ۱٪ باک).\n" +
        "مثال: اگر ۵ بفرستی، پر کردن ۲۰٪ باک = ۱۰۰ Solen."
    );
  });

  //
  // 🚗 ثبت وسیله (در گروه شاپ، ویزارد در همان گروه)
  //
  bot.hears("ثبت وسیله", async (ctx) => {
    if (!isGroup(ctx)) return;

    const shopId = await getShopChatId(ctx);
    if (!shopId || ctx.chat!.id !== shopId) return;

    if (!(await isShopAdminOrMaster(ctx))) {
      await ctx.reply("این دستور فقط برای ارباب یا ادمین‌های شاپ فعال است.");
      return;
    }

    const s = ctx.session as SessionData;
    s.vehicleWizard = {
      mode: "create",
      chatId: ctx.chat!.id,
      adminId: ctx.from!.id,
      step: "ask_char_code",
    };

    await ctx.reply(
      "🚗 ثبت وسیله جدید\n" +
        "ابتدا آیدی شخصی کاراکتر (char_code) را بفرست.\n" +
        "مثال: NECRO_ASHEN_01"
    );
  });

  //
  // 🎛 هندل پیام‌های متنی برای:
  //  - قیمت فلوکس (awaitingFluxPrice)
  //  - ویزارد ثبت وسیله (vehicleWizard)
  //
  bot.on("message:text", async (ctx) => {
    const s = ctx.session as SessionData;
    const { supabase } = ctx.services;
    const text = ctx.message.text.trim();

    //
    // قیمت فلوکس
    //
    if (s.awaitingFluxPrice && isMaster(ctx)) {
      const raw = text.replace(",", ".");
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

      s.awaitingFluxPrice = false;
      await ctx.reply(
        `✅ قیمت پایه فلوکس روی ${value} Solen برای هر ۱٪ باک تنظیم شد.`
      );
      return;
    }

    //
    // ویزارد ثبت وسیله
    //
    if (!s.vehicleWizard) return;

    const w = s.vehicleWizard;

    // فقط پیام‌های ادمین همان چت
    if (
      !ctx.chat ||
      ctx.chat.id !== w.chatId ||
      !ctx.from ||
      ctx.from.id !== w.adminId
    ) {
      return;
    }

    const step = w.step;

    if (step === "ask_char_code") {
      const { data: char, error } = await supabase
        .from("characters")
        .select(
          "id, char_name, clan_name, char_code, current_region_id, current_spot_id"
        )
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

      w.targetCharId = char.id;
      w.targetCharCode = char.char_code;
      w.targetCharName = char.char_name;
      w.targetClanName = char.clan_name;
      w.step = "ask_type";

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
      w.vehicleType = text;
      w.step = "ask_capacity";
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
      w.capacity = cap;
      w.step = "ask_title";
      await ctx.reply("نام نمایش وسیله را بفرست (مثال: شبح نقره‌ای).");
      return;
    }

    if (step === "ask_title") {
      w.title = text;
      w.step = "confirm";

      await ctx.reply(
        "🧾 خلاصه اطلاعات وسیله:\n" +
          `صاحب:\n` +
          `• نام: ${w.targetCharName || "—"}\n` +
          `• کد: ${w.targetCharCode}\n` +
          `• خاندان: ${w.targetClanName || "—"}\n\n` +
          `وسیله:\n` +
          `• نوع: ${w.vehicleType}\n` +
          `• ظرفیت سرنشین: ${w.capacity}\n` +
          `• نام: ${w.title}\n\n` +
          "اگر تایید می‌کنی، بنویس: «تایید»\n" +
          "اگر نمی‌خواهی، بنویس: «لغو»"
      );
      return;
    }

    if (step === "confirm") {
      if (text === "لغو") {
        s.vehicleWizard = undefined;
        await ctx.reply("❌ ثبت وسیله لغو شد.");
        return;
      }
      if (text !== "تایید") {
        await ctx.reply("برای تایید بنویس «تایید»، برای لغو بنویس «لغو».");
        return;
      }

      if (
        !w.targetCharId ||
        !w.vehicleType ||
        w.capacity === undefined ||
        !w.title
      ) {
        await ctx.reply("اطلاعات ناقص است، ویزارد ریست می‌شود.");
        s.vehicleWizard = undefined;
        return;
      }

      // لوکیشن فعلی کاراکتر برای لوکیشن اولیه وسیله
      const { data: char, error: charErr } = await supabase
        .from("characters")
        .select("current_region_id, current_spot_id")
        .eq("id", w.targetCharId)
        .maybeSingle();

      if (charErr) {
        console.error("reload character error:", charErr);
      }

      const insertPayload: any = {
        owner_char_id: w.targetCharId,
        title: w.title,
        type: w.vehicleType,
        capacity: w.capacity,
        fuel_percent: 100,
      };

      if (char) {
        insertPayload.current_region_id = char.current_region_id;
        insertPayload.current_spot_id = char.current_spot_id;
      }

      const { error } = await supabase
        .from("vehicles")
        .insert(insertPayload)
        .single();

      if (error) {
        console.error("insert vehicle error:", error);
        await ctx.reply("در ثبت وسیله مشکلی پیش آمد. لطفاً بعداً دوباره تلاش کن.");
        s.vehicleWizard = undefined;
        return;
      }

      await ctx.reply(
        "✅ وسیله با موفقیت ثبت شد.\n" +
          "سوخت اولیه: ۱۰۰٪ فلوکس.\n" +
          "اگر لوکیشن کاراکتر مشخص بود، این همان نقطه‌ی اولیه‌ی وسیله است."
      );

      s.vehicleWizard = undefined;
      return;
    }
  });

  //
  // (بعداً اینجا می‌تونیم: حذف وسیله، ویرایش وسیله، لیست افراد دارای وسیله نقلیه رو هم اضافه کنیم)
  //
}
