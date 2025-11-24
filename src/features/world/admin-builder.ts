import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// پاک کردن آخرین پیام مدیریتی توی پی‌وی ارباب
async function deleteLastPm(ctx: MyContext) {
  try {
    if (ctx.chat?.type === "private" && ctx.session.__last_pm_id) {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.session.__last_pm_id);
    }
  } catch {
    // اگر نتونست پاک کنه مهم نیست
  }
  ctx.session.__last_pm_id = undefined;
}

// ارسال پیام مدیریتی و ذخیره ID برای پاک‌سازی بعدی
async function sendManagedPm(
  ctx: MyContext,
  text: string,
  extra: Parameters<MyContext["reply"]>[1] = {}
) {
  const msg = await ctx.reply(text, extra);
  ctx.session.__last_pm_id = msg.message_id;
}

// کمکی: گرفتن Region براساس chat_id
async function getRegionByChatId(ctx: MyContext, chatId: number) {
  const { supabase } = ctx.services;
  const { data, error } = await supabase
    .from("regions")
    .select("*")
    .eq("telegram_chat_id", chatId)
    .single();

  if (error || !data) return null;
  return data;
}

export function registerWorldAdminFeature(bot: Bot<MyContext>) {
  // /worldadmin داخل گروه
  bot.command("worldadmin", async (ctx) => {
    if (ctx.from?.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم میتونه بهم دستور بده، حدتو بدون");
      return;
    }

    const chat = ctx.chat;
    if (!chat) return;

    // اگر تو PV زدی
    if (chat.type === "private") {
      await ctx.reply(
        "برای مدیریت یک گروه، دستور /worldadmin رو داخل همون گروه بزن.\n" +
          "من پیام دستور رو اونجا پاک می‌کنم و پنل رو توی پی‌ویت باز می‌کنم."
      );
      return;
    }

    const chatId = chat.id;
    const title = chat.title ?? `Group ${chatId}`;

    // حذف پیام دستور در گروه
    if (ctx.message) {
      try {
        await ctx.api.deleteMessage(chatId, ctx.message.message_id);
      } catch {
        // اگر پرمیشن نداشتی، مهم نیست
      }
    }

    // ارسال پنل به پی‌وی ارباب
    const kb = new InlineKeyboard()
      .text("📍 ثبت Region", `adm_region_new:${chatId}`)
      .row()
      .text("🗂 داشبورد Region", `adm_dash:${chatId}`)
      .row()
      .text("➕ ساخت Spot", `adm_spot_new:${chatId}`)
      .row()
      .text("🔗 ساخت Edge", `adm_edge_new:${chatId}`);

    await ctx.api.sendMessage(
      MASTER_ID,
      `پنل مدیریت برای گروه:\n«${title}» (chat_id: ${chatId})`,
      { reply_markup: kb }
    );
  });

  // هندل دکمه‌ها
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";

    // فقط دکمه‌هایی که با adm_ شروع می‌شن
    if (!data.startsWith("adm_")) {
      await next();
      return;
    }

    if (ctx.from?.id !== MASTER_ID) {
      await ctx.answerCallbackQuery({
        text: "فقط اربابم میتونه منو کنترل کنه، حدتو بدون",
        show_alert: true
      });
      return;
    }

    const { supabase } = ctx.services;

    // ---- ثبت Region برای یک گروه ----
    if (data.startsWith("adm_region_new:")) {
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      const chatId = Number(data.split(":")[1]);
      const { data: existing } = await supabase
        .from("regions")
        .select("*")
        .eq("telegram_chat_id", chatId)
        .single();

      if (existing) {
        await sendManagedPm(
          ctx,
          `Region قبلاً ثبت شده:\n${existing.title} (id: ${existing.id})`
        );
        return;
      }

      const title = `Region ${chatId}`;
      const slug = slugify(title);

      const { data: inserted, error } = await supabase
        .from("regions")
        .insert({
          slug,
          title,
          telegram_chat_id: chatId
        })
        .select("*")
        .single();

      if (error || !inserted) {
        await sendManagedPm(ctx, "خطا در ساخت Region.");
        return;
      }

      await sendManagedPm(
        ctx,
        `Region جدید ثبت شد:\n${inserted.title} (id: ${inserted.id})`
      );
      return;
    }

    // ---- داشبورد Region ----
    if (data.startsWith("adm_dash:")) {
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      const chatId = Number(data.split(":")[1]);
      const region = await getRegionByChatId(ctx, chatId);

      if (!region) {
        await sendManagedPm(ctx, "Region برای این چت ثبت نشده.");
        return;
      }

      const { data: spots, error: spErr } = await supabase
        .from("spots")
        .select("id,title")
        .eq("region_id", region.id);

      if (spErr) {
        await sendManagedPm(ctx, "خطا در خواندن Spotها.");
        return;
      }

      const spotIds = spots?.map((s: any) => s.id) || [];

      let edges: any[] = [];
      if (spotIds.length > 0) {
        const { data: edgeRows, error: edErr } = await supabase
          .from("edges")
          .select("id,from_spot_id,to_spot_id,travel_seconds")
          .in("from_spot_id", spotIds);

        if (!edErr && edgeRows) edges = edgeRows;
      }

      let text = `📍 داشبورد Region\n${region.title}\n\n`;
      text += `Spotها: ${spots?.length ?? 0}\n`;
      text += `Edgeها: ${edges.length}\n\n`;

      if (edges.length > 0) {
        text += "📌 مسیرها:\n";
        for (const e of edges) {
          text += `• ${e.from_spot_id} → ${e.to_spot_id} (${e.travel_seconds}s)\n`;
        }
      }

      const kb = new InlineKeyboard()
        .text("🔄 Refresh", `adm_dash:${chatId}`)
        .row()
        .text("➕ Spot", `adm_spot_new:${chatId}`)
        .text("➕ Edge", `adm_edge_new:${chatId}`);

      await sendManagedPm(ctx, text.trim(), { reply_markup: kb });
      return;
    }

    // ---- ساخت Spot ----
    if (data.startsWith("adm_spot_new:")) {
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      const chatId = Number(data.split(":")[1]);
      const region = await getRegionByChatId(ctx, chatId);

      if (!region) {
        await sendManagedPm(ctx, "Region برای این چت ثبت نشده. اول Region بساز.");
        return;
      }

      ctx.session.mode = "create_spot";
      ctx.session.pending_region_id = region.id;

      await sendManagedPm(
        ctx,
        `در Region «${region.title}» هستیم.\nاسم Spot جدید را بفرست:`
      );
      return;
    }

    // ---- ساخت Edge: مرحله ۱ (انتخاب مبدا) ----
    if (data.startsWith("adm_edge_new:")) {
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      const chatId = Number(data.split(":")[1]);
      const region = await getRegionByChatId(ctx, chatId);

      if (!region) {
        await sendManagedPm(ctx, "Region برای این چت ثبت نشده.");
        return;
      }

      const { data: spots } = await supabase
        .from("spots")
        .select("id,title")
        .eq("region_id", region.id);

      if (!spots || spots.length === 0) {
        await sendManagedPm(
          ctx,
          "برای ساخت Edge اول باید حداقل یک Spot در این Region بسازی."
        );
        return;
      }

      const kb = new InlineKeyboard();
      for (const s of spots) {
        kb.text(s.title, `adm_edge_from:${s.id}`).row();
      }

      await sendManagedPm(
        ctx,
        "Spot مبدا مسیر را انتخاب کن:",
        { reply_markup: kb }
      );
      return;
    }

    // ---- ساخت Edge: مرحله ۲ (انتخاب مقصد) ----
    if (data.startsWith("adm_edge_from:")) {
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      const fromSpotId = data.split(":")[1];
      ctx.session.edge_from_spot_id = fromSpotId;

      // مقصد می‌تونه هر Spotی در جهان باشه
      const { data: spots, error: spErr } = await supabase
        .from("spots")
        .select("id,title");

      if (spErr || !spots || spots.length === 0) {
        await sendManagedPm(ctx, "هیچ Spotی در جهان ثبت نشده.");
        return;
      }

      const kb = new InlineKeyboard();
      for (const s of spots) {
        kb.text(s.title, `adm_edge_to:${s.id}`).row();
      }

      await sendManagedPm(
        ctx,
        "حالا Spot مقصد را انتخاب کن:",
        { reply_markup: kb }
      );
      return;
    }

    // ---- ساخت Edge: مرحله ۳ (گرفتن زمان سفر) ----
    if (data.startsWith("adm_edge_to:")) {
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      const toSpotId = data.split(":")[1];
      ctx.session.edge_to_spot_id = toSpotId;
      ctx.session.mode = "edge_time";

      await sendManagedPm(
        ctx,
        "زمان سفر (به ثانیه) را به‌صورت عدد بفرست.\nمثال: 60"
      );
      return;
    }

    await next();
  });

  // پیام‌های متنی ارباب در پی‌وی برای ساخت Spot و Edge
  bot.on("message:text", async (ctx, next) => {
    if (ctx.from?.id !== MASTER_ID || ctx.chat?.type !== "private") {
      await next();
      return;
    }

    const { supabase } = ctx.services;
    const mode = ctx.session.mode;

    // --- ساخت Spot ---
    if (mode === "create_spot") {
      const regionId = ctx.session.pending_region_id;

      if (!regionId) {
        ctx.session.mode = undefined;
        ctx.session.pending_region_id = undefined;
        await deleteLastPm(ctx);
        await sendManagedPm(
          ctx,
          "Region مشخص نیست. دوباره از /worldadmin و دکمه‌ی Spot شروع کن."
        );
        return;
      }

      const name = ctx.message.text.trim();
      if (!name) {
        await deleteLastPm(ctx);
        await sendManagedPm(ctx, "اسم Spot نمی‌تونه خالی باشه.");
        return;
      }

      const slug = slugify(name);

      const { error } = await supabase.from("spots").insert({
        region_id: regionId,
        slug,
        title: name
      });

      ctx.session.mode = undefined;
      ctx.session.pending_region_id = undefined;

      await deleteLastPm(ctx);
      await sendManagedPm(
        ctx,
        error ? "خطا در ساخت Spot." : `Spot «${name}» ساخته شد.`
      );
      return;
    }

    // --- تنظیم زمان Edge ---
    if (mode === "edge_time") {
      const fromId = ctx.session.edge_from_spot_id;
      const toId = ctx.session.edge_to_spot_id;

      if (!fromId || !toId) {
        ctx.session.mode = undefined;
        ctx.session.edge_from_spot_id = undefined;
        ctx.session.edge_to_spot_id = undefined;

        await deleteLastPm(ctx);
        await sendManagedPm(
          ctx,
          "مبدا یا مقصد مشخص نیست. دوباره ساخت Edge را از اول شروع کن."
        );
        return;
      }

      const raw = ctx.message.text.trim();
      const t = Number(raw);

      if (!Number.isFinite(t) || t < 0) {
        await deleteLastPm(ctx);
        await sendManagedPm(
          ctx,
          "زمان سفر باید یک عدد مثبت (ثانیه) باشد. مثال: 90"
        );
        return;
      }

      const { error } = await supabase.from("edges").insert({
        from_spot_id: fromId,
        to_spot_id: toId,
        travel_seconds: Math.floor(t),
        is_portal: false,
        conditions: {}
      });

      ctx.session.mode = undefined;
      ctx.session.edge_from_spot_id = undefined;
      ctx.session.edge_to_spot_id = undefined;

      await deleteLastPm(ctx);
      await sendManagedPm(
        ctx,
        error
          ? "خطا در ثبت Edge."
          : `مسیر با موفقیت ثبت شد.\nزمان سفر: ${Math.floor(t)} ثانیه.`
      );
      return;
    }

    await next();
  });
}
