import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function registerWorldAdminFeature(bot: Bot<MyContext>) {
  // /worldadmin
  bot.command("worldadmin", async (ctx) => {
    if (ctx.from?.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم میتونه بهم دستور بده، حدتو بدون");
      return;
    }

    const chat = ctx.chat;
    if (!chat) {
      await ctx.reply("این دستور باید داخل گروهی که میخوای مدیریت کنی ارسال بشه.");
      return;
    }

    // اگر تو پی‌وی زدی:
    if (chat.type === "private") {
      await ctx.reply(
        "برای مدیریت یک گروه، دستور /worldadmin رو داخل همون گروه بفرست.\n" +
          "من پیام رو پاک می‌کنم و ادامه‌ی کار رو توی پی‌وی خودت انجام می‌دم."
      );
      return;
    }

    // اینجاست: تو گروه هستیم
    const targetChatId = chat.id;
    const title = chat.title || `Chat ${targetChatId}`;

    // سعی کن پیام دستور رو پاک کنی (اگر پرمیشن داشتی)
    if (ctx.message) {
      try {
        await ctx.api.deleteMessage(chat.id, ctx.message.message_id);
      } catch {
        // اگر نتونه پاک کنه، مهم نیست
      }
    }

    // پنل رو تو پی‌وی ارباب بفرست
    const kb = new InlineKeyboard()
      .text("📍 ثبت/ساخت Region برای این چت", `admin:region_here:${targetChatId}`)
      .row()
      .text("➕ ساخت Spot جدید در این Region", `admin:new_spot_here:${targetChatId}`)
      .row()
      .text("🔗 ساخت مسیر (Edge) در این Region", `admin:new_edge_here:${targetChatId}`)
      .row()
      .text("🗑 (بعداً) حذف‌ها", `admin:delete_menu:${targetChatId}`);

    await ctx.api.sendMessage(
      MASTER_ID,
      `پنل مدیریت برای این گروه:\n«${title}»\n(chat_id: ${targetChatId})`,
      { reply_markup: kb }
    );
  });

  // هندل کلی callbackهای admin
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    if (!data.startsWith("admin:")) {
      await next();
      return;
    }

    if (ctx.from?.id !== MASTER_ID) {
      await ctx.answerCallbackQuery({
        text: "فقط اربابم میتونه بهم دستور بده، حدتو بدون",
        show_alert: true,
      });
      return;
    }

    const { supabase } = ctx.services;

    const parts = data.split(":"); // admin:action:chatId[:extra]
    const action = parts[1];
    const chatIdStr = parts[2];
    const targetChatId = Number(chatIdStr);

    // 1) ثبت Region برای این چت
    if (action === "region_here") {
      await ctx.answerCallbackQuery();

      const { data: existing, error } = await supabase
        .from("regions")
        .select("id, title")
        .eq("telegram_chat_id", targetChatId)
        .single();

      if (existing && !error) {
        await ctx.reply(`این چت قبلاً به‌عنوان Region ثبت شده:\n«${existing.title}»`);
        return;
      }

      // چون الان تو پی‌وی هستیم، اسم گروه رو نداریم؛ از چت اصلی تلگرام نمی‌تونیم بخونیم
      // پس فعلاً عنوان رو بر اساس chat_id می‌ذاریم، بعداً می‌تونی تو DB ادیت کنی یا با /settitle
      const title = `Region ${targetChatId}`;
      const slug = slugify(title) || `region-${targetChatId}`;

      const { data: inserted, error: insErr } = await supabase
        .from("regions")
        .insert({
          slug,
          title,
          telegram_chat_id: targetChatId,
        })
        .select("id, title")
        .single();

      if (insErr || !inserted) {
        console.error("Supabase insert region error:", insErr);
        await ctx.reply("خطا در ثبت Region برای این چت.");
        return;
      }

      await ctx.reply(`Region جدید ثبت شد:\n«${inserted.title}»`);
      return;
    }

    // 2) ساخت Spot جدید در این Region
    if (action === "new_spot_here") {
      await ctx.answerCallbackQuery();

      const { data: region, error: regionErr } = await supabase
        .from("regions")
        .select("id, title")
        .eq("telegram_chat_id", targetChatId)
        .single();

      if (regionErr || !region) {
        await ctx.reply(
          "برای این چت هنوز Region ثبت نشده.\n" +
            "اول دکمه‌ی «ثبت/ساخت Region برای این چت» رو بزن."
        );
        return;
      }

      ctx.session.mode = "create_spot";
      ctx.session.pending_region_id = region.id;

      await ctx.reply(
        `Region هدف: «${region.title}»\n` +
          "حالا اسم Spot جدید رو به‌صورت یک پیام بفرست.\n" +
          "مثال: «بازار اصلی»، «دروازه شمالی»، ..."
      );
      return;
    }

    // 3) ساخت مسیر جدید در این Region (Edge)
    if (action === "new_edge_here") {
      await ctx.answerCallbackQuery();

      const { data: region, error: regionErr } = await supabase
        .from("regions")
        .select("id, title")
        .eq("telegram_chat_id", targetChatId)
        .single();

      if (regionErr || !region) {
        await ctx.reply(
          "برای این چت هنوز Region ثبت نشده.\n" +
            "اول دکمه‌ی «ثبت/ساخت Region برای این چت» رو بزن."
        );
        return;
      }

      const { data: spots, error: spotsErr } = await supabase
        .from("spots")
        .select("id, title")
        .eq("region_id", region.id);

      if (spotsErr) {
        console.error("Supabase spots error:", spotsErr);
        await ctx.reply("خطا در خواندن Spots این Region.");
        return;
      }

      if (!spots || spots.length < 2) {
        await ctx.reply(
          "برای ساخت مسیر، حداقل دو Spot در این Region لازم داریم.\n" +
            "اول چند Spot بساز."
        );
        return;
      }

      const kbFrom = new InlineKeyboard();
      spots.forEach((s: any) => {
        kbFrom.text(s.title, `admin:edge_from:${targetChatId}:${s.id}`).row();
      });

      await ctx.reply(
        `Region هدف: «${region.title}»\n` +
          "ابتدا Spot مبدا مسیر را انتخاب کن:",
        { reply_markup: kbFrom }
      );

      return;
    }

    // 4) انتخاب مبدا Edge
    if (action === "edge_from") {
      await ctx.answerCallbackQuery();
      const fromId = parts[3];

      ctx.session.edge_from_spot_id = fromId;
      ctx.session.edge_to_spot_id = undefined;
      ctx.session.mode = undefined;

      const { data: region, error: regionErr } = await supabase
        .from("regions")
        .select("id, title")
        .eq("telegram_chat_id", targetChatId)
        .single();

      if (regionErr || !region) {
        await ctx.reply("Region یافت نشد. دوباره از /worldadmin شروع کن.");
        return;
      }

      const { data: spots, error: spotsErr } = await supabase
        .from("spots")
        .select("id, title")
        .eq("region_id", region.id);

      if (spotsErr || !spots) {
        await ctx.reply("خطا در خواندن Spots مقصد.");
        return;
      }

      const kbTo = new InlineKeyboard();
      spots.forEach((s: any) => {
        kbTo.text(s.title, `admin:edge_to:${targetChatId}:${s.id}`).row();
      });

      await ctx.reply("حالا Spot مقصد را انتخاب کن:", {
        reply_markup: kbTo,
      });

      return;
    }

    // 5) انتخاب مقصد Edge
    if (action === "edge_to") {
      await ctx.answerCallbackQuery();
      const toId = parts[3];

      if (!ctx.session.edge_from_spot_id) {
        await ctx.reply("مبدا مشخص نشده. دوباره از ساخت مسیر شروع کن.");
        return;
      }

      ctx.session.edge_to_spot_id = toId;
      ctx.session.mode = "create_edge_time";

      await ctx.reply(
        "زمان سفر (به ثانیه) را به‌صورت عدد بفرست.\nمثال: 60"
      );

      return;
    }

    // 6) منوی حذف (فعلاً فقط پیام می‌ده)
    if (action === "delete_menu") {
      await ctx.answerCallbackQuery();
      await ctx.reply(
        "سیستم حذف امن (Spot/Edge) در حال طراحی است تا به‌صورت کنترل‌شده کار کند.\n" +
          "فعلاً اگر لازم داری چیزی را پاک کنی، با احتیاط از پنل Supabase انجامش بده."
      );
      return;
    }

    await next();
  });

  // پیام‌های متنی برای ساخت Spot و تنظیم زمان Edge
  bot.on("message:text", async (ctx, next) => {
    // فقط ارباب
    if (ctx.from?.id !== MASTER_ID) {
      await next();
      return;
    }

    const mode = ctx.session.mode;

    const { supabase } = ctx.services;

    // ساخت Spot جدید
    if (mode === "create_spot") {
      const regionId = ctx.session.pending_region_id;
      if (!regionId) {
        ctx.session.mode = undefined;
        await ctx.reply("Region مشخص نبود. دوباره از /worldadmin شروع کن.");
        return;
      }

      const name = ctx.message.text.trim();
      if (!name) {
        await ctx.reply("اسم Spot نمی‌تواند خالی باشد.");
        return;
      }

      const slug = slugify(name) || `spot-${Date.now()}`;

      const { data: spot, error: insErr } = await supabase
        .from("spots")
        .insert({
          region_id: regionId,
          slug,
          title: name,
          is_default: false,
        })
        .select("id, title")
        .single();

      if (insErr || !spot) {
        console.error("Supabase insert spot error:", insErr);
        await ctx.reply("خطا در ساخت Spot جدید.");
        return;
      }

      ctx.session.mode = undefined;
      ctx.session.pending_region_id = undefined;

      await ctx.reply(`Spot جدید ساخته شد:\n«${spot.title}»`);
      return;
    }

    // تنظیم زمان سفر برای Edge
    if (mode === "create_edge_time") {
      const fromId = ctx.session.edge_from_spot_id;
      const toId = ctx.session.edge_to_spot_id;

      if (!fromId || !toId) {
        ctx.session.mode = undefined;
        await ctx.reply("مبدا یا مقصد مشخص نیست. دوباره از /worldadmin شروع کن.");
        return;
      }

      const text = ctx.message.text.trim();
      const travelSeconds = Number(text);

      if (!Number.isFinite(travelSeconds) || travelSeconds < 0) {
        await ctx.reply("زمان سفر باید یک عدد مثبت (ثانیه) باشد. مثال: 90");
        return;
      }

      const { error: edgeErr } = await supabase.from("edges").insert({
        from_spot_id: fromId,
        to_spot_id: toId,
        travel_seconds: Math.floor(travelSeconds),
        is_portal: false,
        conditions: {},
      });

      if (edgeErr) {
        console.error("Supabase insert edge error:", edgeErr);
        await ctx.reply("خطا در ثبت مسیر (Edge).");
        return;
      }

      ctx.session.mode = undefined;
      ctx.session.edge_from_spot_id = undefined;
      ctx.session.edge_to_spot_id = undefined;

      await ctx.reply(
        `مسیر با موفقیت ثبت شد.\nزمان سفر: ${Math.floor(travelSeconds)} ثانیه.`
      );
      return;
    }

    await next();
  });
}
