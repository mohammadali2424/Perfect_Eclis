import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function cleanPM(ctx: MyContext) {
  // پیام PM قبلی را اگر داریم پاک می‌کنیم:
  try {
    if (ctx.session.__last_pm_id) {
      await ctx.api.deleteMessage(ctx.chat!.id, ctx.session.__last_pm_id);
      ctx.session.__last_pm_id = undefined;
    }
  } catch {}
}

async function sendPM(ctx: MyContext, text: string, extra: any = {}) {
  const msg = await ctx.reply(text, extra);
  ctx.session.__last_pm_id = msg.message_id;
}

export function registerWorldAdminFeature(bot: Bot<MyContext>) {
  // /worldadmin داخل گروه
  bot.command("worldadmin", async (ctx) => {
    if (ctx.from?.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم میتونه بهم دستور بده، حدتو بدون");
      return;
    }
    if (!ctx.chat) return;

    if (ctx.chat.type === "private") {
      await ctx.reply(
        "برای مدیریت گروه، دستور را در همان گروه اجرا کن تا پنل در PM باز شود."
      );
      return;
    }

    const chatId = ctx.chat.id;
    const title = ctx.chat.title ?? `Group ${chatId}`;

    // حذف دستور از گروه
    if (ctx.message) {
      try {
        await ctx.api.deleteMessage(chatId, ctx.message.message_id);
      } catch {}
    }

    // پنل مدیریت در PM
    const kb = new InlineKeyboard()
      .text("📍 ثبت Region", `adm:r:new:${chatId}`)
      .row()
      .text("🗂 داشبورد Region", `adm:dash:${chatId}`)
      .row()
      .text("➕ ساخت Spot", `adm:spot:new:${chatId}`)
      .row()
      .text("🔗 ساخت مسیر (Edge)", `adm:edge:new:${chatId}`)
      .row()
      .text("🗑 حذف چیزها", `adm:delete:${chatId}`);

    await ctx.api.sendMessage(
      MASTER_ID,
      `پنل مدیریت برای گروه:\n«${title}»`,
      { reply_markup: kb }
    );
  });

  // Callback
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data!;
    if (!data.startsWith("adm:")) return next();

    if (ctx.from?.id !== MASTER_ID) {
      await ctx.answerCallbackQuery({
        text: "فقط اربابم میتونه منو کنترل کنه، حدتو بدون",
        show_alert: true,
      });
      return;
    }

    const { supabase } = ctx.services;
    const parts = data.split(":"); // adm:action:...
    const action = parts[1];

    // --------------------------
    //  بخش: ساخت Region
    // --------------------------
    if (action === "r") {
      const mode = parts[2]; // new
      const chatId = Number(parts[3]);

      if (mode === "new") {
        await ctx.answerCallbackQuery();
        await cleanPM(ctx);

        // آیا قبلاً Region ثبت شده؟
        const { data: region, error } = await supabase
          .from("regions")
          .select("*")
          .eq("telegram_chat_id", chatId)
          .maybeSingle();

        if (region) {
          return sendPM(
            ctx,
            `Region قبلاً ثبت شده:\n${region.title} (id: ${region.id})`
          );
        }

        // می‌سازیم
        const title = `Region ${chatId}`;
        const slug = slugify(title);

        const { data: newReg, error: insErr } = await supabase
          .from("regions")
          .insert({
            slug,
            title,
            telegram_chat_id: chatId,
          })
          .select()
          .single();

        if (insErr)
          return sendPM(ctx, "خطا در ساخت Region.");

        return sendPM(
          ctx,
          `Region جدید ساخته شد:\n${newReg.title} (id: ${newReg.id})`
        );
      }
    }

    // --------------------------
    //  بخش: داشبورد Region
    // --------------------------
    if (action === "dash") {
      const chatId = Number(parts[2]);
      await ctx.answerCallbackQuery();
      await cleanPM(ctx);

      // Region
      const { data: region } = await supabase
        .from("regions")
        .select("*")
        .eq("telegram_chat_id", chatId)
        .maybeSingle();

      if (!region)
        return sendPM(ctx, "Region برای این چت ثبت نشده.");

      // Spots
      const { data: spots, error: spErr } = await supabase
        .from("spots")
        .select("*")
        .eq("region_id", region.id);

      // Edges
      const spotIds = spots?.map((s: any) => s.id) ?? [];
      const { data: edges } = await supabase
        .from("edges")
        .select("*")
        .in("from_spot_id", spotIds);

      const kb = new InlineKeyboard()
        .text("🔄 Refresh", `adm:dash:${chatId}`)
        .row()
        .text("➕ Spot", `adm:spot:new:${chatId}`)
        .text("➕ Edge", `adm:edge:new:${chatId}`);

      let text = `📍 داشبورد ${region.title}\n\n`;
      text += `Spotها: ${spots?.length ?? 0}\n`;
      text += `Edgeها: ${edges?.length ?? 0}\n\n`;

      if (edges && edges.length > 0) {
        text += "📌 مسیرها:\n";
        edges.forEach((e: any) => {
          text += `• از ${e.from_spot_id} ➝ ${e.to_spot_id} (${e.travel_seconds}s)\n`;
        });
      }

      return sendPM(ctx, text, { reply_markup: kb });
    }

    // --------------------------
    //  بخش: ساخت Spot
    // --------------------------
    if (action === "spot") {
      const mode = parts[2]; // new
      const chatId = Number(parts[3]);
      await ctx.answerCallbackQuery();

      // Region باید باشد
      const { data: region } = await supabase
        .from("regions")
        .select("*")
        .eq("telegram_chat_id", chatId)
        .maybeSingle();

      if (!region)
        return sendPM(ctx, "Region برای این چت وجود ندارد.");

      ctx.session.mode = "create_spot";
      ctx.session.pending_region_id = region.id;

      await cleanPM(ctx);
      return sendPM(
        ctx,
        `ساخت Spot جدید در Region «${region.title}»\n\nاسم Spot را بفرست:`
      );
    }

    // --------------------------
    //  بخش: ساخت Edge (مرحله انتخاب مبدا)
    // --------------------------
    if (action === "edge") {
      const mode = parts[2]; // new / from / to
      const chatId = Number(parts[3]);
      await ctx.answerCallbackQuery();

      // پیدا کردن Region
      const { data: region } = await supabase
        .from("regions")
        .select("*")
        .eq("telegram_chat_id", chatId)
        .maybeSingle();

      if (!region)
        return sendPM(ctx, "Region وجود ندارد.");

      // مرحله اول: new → انتخاب مبدا
      if (mode === "new") {
        const { data: spots } = await supabase
          .from("spots")
          .select("*")
          .eq("region_id", region.id);

        if (!spots || spots.length < 1)
          return sendPM(ctx, "اول باید Spot بسازی.");

        const kb = new InlineKeyboard();
        spots.forEach((s: any) => {
          kb.text(s.title, `adm:edge:from:${chatId}:${s.id}`).row();
        });

        await cleanPM(ctx);
        return sendPM(ctx, "Spot مبدا را انتخاب کن:", { reply_markup: kb });
      }

      // مرحله دوم: انتخاب مبدا
      if (mode === "from") {
        const fromSpotId = parts[4];
        ctx.session.edge_from_spot_id = fromSpotId;

        const { data: spots } = await supabase
          .from("spots")
          .select("*");

        if (!spots)
          return sendPM(ctx, "Spot یافت نشد.");

        const kb = new InlineKeyboard();
        spots.forEach((s: any) => {
          kb.text(s.title, `adm:edge:to:${chatId}:${s.id}`).row();
        });

        await cleanPM(ctx);
        return sendPM(ctx, "Spot مقصد را انتخاب کن:", { reply_markup: kb });
      }

      // مرحله سوم: انتخاب مقصد
      if (mode === "to") {
        const toSpotId = parts[4];
        ctx.session.edge_to_spot_id = toSpotId;
        ctx.session.mode = "edge_time";

        await cleanPM(ctx);
        return sendPM(
          ctx,
          "زمان سفر (ثانیه) را ارسال کن:",
        );
      }
    }

    // --------------------------
    // حذف داشبورد
    // --------------------------
    if (action === "delete") {
      const chatId = Number(parts[2]);
      await ctx.answerCallbackQuery();
      await cleanPM(ctx);

      const kb = new InlineKeyboard()
        .text("🗑 حذف Spot", `adm:del:spot:${chatId}`)
        .row()
        .text("🗑 حذف Edge", `adm:del:edge:${chatId}`);

      return sendPM(ctx, "منوی حذف:", { reply_markup: kb });
    }

    // --------------------------
    // حذف Spot
    // --------------------------
    if (action === "del") {
      const type = parts[2];
      const chatId = Number(parts[3]);
      await ctx.answerCallbackQuery();

      if (type === "spot") {
        // لیست Spotها
        const { data: region } = await supabase
          .from("regions")
          .select("*")
          .eq("telegram_chat_id", chatId)
          .maybeSingle();

        if (!region)
          return sendPM(ctx, "Region وجود ندارد.");

        const { data: spots } = await supabase
          .from("spots")
          .select("*")
          .eq("region_id", region.id);

        if (!spots || spots.length === 0)
          return sendPM(ctx, "Spot وجود ندارد.");

        const kb = new InlineKeyboard();
        spots.forEach((s: any) => {
          kb.text(s.title, `adm:delspot:${s.id}`).row();
        });

        await cleanPM(ctx);
        return sendPM(ctx, "کدام Spot حذف شود؟", { reply_markup: kb });
      }

      if (type === "edge") {
        const { data: edges } = await supabase
          .from("edges")
          .select("*");

        if (!edges || edges.length === 0)
          return sendPM(ctx, "Edge وجود ندارد.");

        const kb = new InlineKeyboard();
        edges.forEach((e: any) => {
          kb.text(
            `${e.from_spot_id} → ${e.to_spot_id}`,
            `adm:deledge:${e.id}`
          ).row();
        });

        await cleanPM(ctx);
        return sendPM(ctx, "کدام Edge حذف شود؟", { reply_markup: kb });
      }
    }

    // --------------------------
    // تأیید حذف Spot
    // --------------------------
    if (action === "delspot") {
      const spotId = parts[2];
      await ctx.answerCallbackQuery();

      const { error } = await supabase
        .from("spots")
        .delete()
        .eq("id", spotId);

      await cleanPM(ctx);
      return sendPM(ctx, error ? "خطا در حذف Spot." : "Spot حذف شد.");
    }

    // --------------------------
    // تأیید حذف Edge
    // --------------------------
    if (action === "deledge") {
      const edgeId = parts[2];
      await ctx.answerCallbackQuery();

      const { error } = await supabase
        .from("edges")
        .delete()
        .eq("id", edgeId);

      await cleanPM(ctx);
      return sendPM(ctx, error ? "خطا در حذف Edge." : "Edge حذف شد.");
    }

    return next();
  });

  // --------------------------
  // پیام متنی برای ساخت Spot و Edge time
  // --------------------------
  bot.on("message:text", async (ctx, next) => {
    if (ctx.from?.id !== MASTER_ID) return next();
    const mode = ctx.session.mode;
    const { supabase } = ctx.services;

    // ساخت Spot
    if (mode === "create_spot") {
      const regionId = ctx.session.pending_region_id;
      if (!regionId)
        return sendPM(ctx, "Region مشخص نبود.");

      const name = ctx.message.text.trim();
      const slug = slugify(name);

      const { error } = await supabase
        .from("spots")
        .insert({
          region_id: regionId,
          slug,
          title: name,
        });

      ctx.session.mode = undefined;
      ctx.session.pending_region_id = undefined;

      await cleanPM(ctx);
      return sendPM(ctx, error ? "خطا در ساخت Spot." : "Spot ساخته شد.");
    }

    // زمان Edge
    if (mode === "edge_time") {
      const fromId = ctx.session.edge_from_spot_id;
      const toId = ctx.session.edge_to_spot_id;

      const t = Number(ctx.message.text.trim());
      if (!Number.isFinite(t) || t < 0)
        return sendPM(ctx, "زمان باید عدد مثبت باشد.");

      const { error } = await supabase.from("edges").insert({
        from_spot_id: fromId,
        to_spot_id: toId,
        travel_seconds: Math.floor(t),
      });

      ctx.session.mode = undefined;
      ctx.session.edge_from_spot_id = undefined;
      ctx.session.edge_to_spot_id = undefined;

      await cleanPM(ctx);
      return sendPM(ctx, error ? "خطا در ساخت Edge." : "Edge ساخته شد.");
    }

    return next();
  });
}
