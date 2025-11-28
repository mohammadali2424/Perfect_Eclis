import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-") // حروف فارسی + لاتین
    .replace(/^-+|-+$/g, "");
}

export function registerWorldAdminFeature(bot: Bot<MyContext>) {
  // پنل اصلی
  bot.command("worldadmin", async (ctx) => {
    if (ctx.from?.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم میتونه بهم دستور بده، حدتو بدون");
      return;
    }

    if (!ctx.chat) {
      await ctx.reply("این دستور باید داخل یک چت (PV یا گروه) اجرا بشه.");
      return;
    }

    const kb = new InlineKeyboard()
      .text("📍 ثبت/ساخت Region برای این چت", "admin:region_here").row()
      .text("➕ ساخت Spot جدید در این Region", "admin:new_spot_here").row()
      .text("🔗 ساخت مسیر (Edge) در این Region", "admin:new_edge_here");

    await ctx.reply("پنل مدیریت جهان اکلیس برای این چت:", { reply_markup: kb });
  });

  // هندل کردن کلیک‌های admin
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

    const chat = ctx.chat;
    if (!chat) {
      await ctx.answerCallbackQuery({ text: "چت نامعتبر.", show_alert: true });
      return;
    }

    const chatId = chat.id;
    const { supabase } = ctx.services;

    if (data === "admin:region_here") {
      await ctx.answerCallbackQuery();

      // ببینیم Region برای این چت هست یا نه
      const { data: existing, error } = await supabase
        .from("regions")
        .select("id, title")
        .eq("telegram_chat_id", chatId)
        .single();

      if (existing && !error) {
        await ctx.reply(`این چت قبلاً به‌عنوان Region ثبت شده:\n«${existing.title}»`);
        return;
      }

      const title = chat.title || "Region " + chatId;
      const slug = slugify(title) || `region-${chatId}`;

      const { data: inserted, error: insErr } = await supabase
        .from("regions")
        .insert({
          slug,
          title,
          telegram_chat_id: chatId,
        })
        .select("id, title")
        .single();

      if (insErr || !inserted) {
        console.error("Supabase insert region error:", insErr);
        await ctx.reply("خطا در ثبت Region برای این چت.");
        return;
      }

      await ctx.reply(`Region جدید برای این چت ثبت شد:\n«${inserted.title}»`);
      return;
    }

    if (data === "admin:new_spot_here") {
      await ctx.answerCallbackQuery();

      // باید Region این چت وجود داشته باشد
      const { data: region, error: regionErr } = await supabase
        .from("regions")
        .select("id, title")
        .eq("telegram_chat_id", chatId)
        .single();

      if (regionErr || !region) {
        await ctx.reply(
          "برای این چت هنوز Region ثبت نشده.\nاول دکمه‌ی «ثبت/ساخت Region برای این چت» رو بزن."
        );
        return;
      }

      // حالت ویزارد: منتظر اسم Spot
      ctx.session.mode = "create_spot";
      ctx.session.pending_region_id = region.id;

      await ctx.reply(
        `در Region «${region.title}» هستیم.\n` +
          "حالا اسم Spot جدید رو به‌صورت یک پیام بفرست.\n" +
          "مثال: «بازار اصلی»، «دروازه شمالی»، ..."
      );
      return;
    }

    if (data === "admin:new_edge_here") {
      await ctx.answerCallbackQuery();

      const { data: region, error: regionErr } = await supabase
        .from("regions")
        .select("id, title")
        .eq("telegram_chat_id", chatId)
        .single();

      if (regionErr || !region) {
        await ctx.reply(
          "برای این چت هنوز Region ثبت نشده.\nاول دکمه‌ی «ثبت/ساخت Region برای این چت» رو بزن."
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
          "برای ساخت مسیر، حداقل دو Spot در این Region لازم داریم.\nاول چند Spot بساز."
        );
        return;
      }

      const kbFrom = new InlineKeyboard();
      spots.forEach((s: any) => {
        kbFrom.text(s.title, `admin:edge_from:${s.id}`).row();
      });

      await ctx.reply(
        `Region فعلی: «${region.title}»\n` +
          "ابتدا Spot مبدا مسیر را انتخاب کن:",
        { reply_markup: kbFrom }
      );

      return;
    }

    // انتخاب مبدا
    if (data.startsWith("admin:edge_from:")) {
      await ctx.answerCallbackQuery();
      const fromId = data.split(":")[2];
      ctx.session.edge_from_spot_id = fromId;
      ctx.session.edge_to_spot_id = undefined;
      ctx.session.mode = undefined;

      const { supabase } = ctx.services;
      const chat = ctx.chat!;
      const { data: region } = await supabase
        .from("regions")
        .select("id")
        .eq("telegram_chat_id", chat.id)
        .single();

      if (!region) {
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
        kbTo.text(s.title, `admin:edge_to:${s.id}`).row();
      });

      await ctx.reply("حالا Spot مقصد را انتخاب کن:", {
        reply_markup: kbTo,
      });

      return;
    }

    // انتخاب مقصد
    if (data.startsWith("admin:edge_to:")) {
      await ctx.answerCallbackQuery();
      const toId = data.split(":")[2];

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

    await next();
  });

  // پیام‌های متنی برای ویزارد Spot و Edge time
  bot.on("message:text", async (ctx, next) => {
    // فقط مستر
    if (ctx.from?.id !== MASTER_ID) {
      await next();
      return;
    }

    const mode = ctx.session.mode;

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

      const { supabase } = ctx.services;
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

      const { supabase } = ctx.services;

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
