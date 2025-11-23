import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// پاک کردن آخرین پیام مدیریتی در PM
async function deleteLastPm(ctx: MyContext) {
  try {
    if (ctx.session.__last_pm_id && ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.session.__last_pm_id);
    }
  } catch {}
  ctx.session.__last_pm_id = undefined;
}

// فرستادن پیام مدیریتی و ذخیره ID آن
async function sendManagedPm(
  ctx: MyContext,
  text: string,
  extra: any = {}
) {
  const msg = await ctx.reply(text, extra);
  ctx.session.__last_pm_id = msg.message_id;
}

// گرفتن Region براساس chat_id
async function getRegionByChat(ctx: MyContext, chatId: number) {
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
  // دستور /worldadmin داخل گروه
  bot.command("worldadmin", async (ctx) => {
    if (ctx.from?.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم میتونه بهم دستور بده، حدتو بدون");
      return;
    }
    const chat = ctx.chat;
    if (!chat) return;

    // اگر تو PV زده شد
    if (chat.type === "private") {
      await ctx.reply(
        "برای مدیریت گروه، دستور را داخل همان گروه بزن تا پنل در پی‌وی باز شود."
      );
      return;
    }

    const chatId = chat.id;

    // حذف پیام دستور در گروه
    if (ctx.message) {
      try {
        await ctx.api.deleteMessage(chatId, ctx.message.message_id);
      } catch {}
    }

    // پنل مدیریت
    const kb = new InlineKeyboard()
      .text("📍 ثبت Region", `adm:r:new:${chatId}`)
      .row()
      .text("🗂 داشبورد", `adm:dash:${chatId}`)
      .row()
      .text("➕ ساخت Spot", `adm:spot:new:${chatId}`)
      .row()
      .text("🔗 ساخت مسیر (Edge)", `adm:edge:new:${chatId}`)
      .row()
      .text("🗑 حذف‌ها", `adm:delete:${chatId}`);

    await ctx.api.sendMessage(
      MASTER_ID,
      `پنل مدیریت گروه:\n${chat.title}`,
      { reply_markup: kb }
    );
  });

  // هندل دکمه‌ها
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    if (!data.startsWith("adm:")) return next();
    if (ctx.from?.id !== MASTER_ID) {
      await ctx.answerCallbackQuery({
        text: "فقط اربابم میتونه منو کنترل کنه، حدتو بدون",
        show_alert: true
      });
      return;
    }

    const { supabase } = ctx.services;
    const parts = data.split(":");
    const section = parts[1];

    // ---------------------- ثبت Region ----------------------
    if (section === "r") {
      const mode = parts[2];
      const chatId = Number(parts[3]);
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      if (mode === "new") {
        const { data: region } = await supabase
          .from("regions")
          .select("*")
          .eq("telegram_chat_id", chatId)
          .single();

        if (region) {
          await sendManagedPm(ctx, `Region قبلاً ثبت شده:\n${region.title}`);
          return;
        }

        const title = `Region ${chatId}`;
        const slug = slugify(title);

        const { data: newReg, error } = await supabase
          .from("regions")
          .insert({
            slug,
            title,
            telegram_chat_id: chatId
          })
          .select()
          .single();

        if (error || !newReg) {
          await sendManagedPm(ctx, "خطا در ساخت Region.");
          return;
        }

        await sendManagedPm(ctx, `Region ساخته شد:\n${newReg.title}`);
        return;
      }
    }

    // ---------------------- داشبورد ----------------------
    if (section === "dash") {
      const chatId = Number(parts[2]);
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      const region = await getRegionByChat(ctx, chatId);
      if (!region) return sendManagedPm(ctx, "Region پیدا نشد.");

      const { data: spots } = await supabase
        .from("spots")
        .select("id,title")
        .eq("region_id", region.id);

      const spotIds = spots?.map((s: any) => s.id) || [];
      const { data: edges } = await supabase
        .from("edges")
        .select("from_spot_id,to_spot_id,travel_seconds")
        .in("from_spot_id", spotIds);

      let text = `📍 داشبورد Region\n${region.title}\n\n`;
      text += `Spotها: ${spots?.length || 0}\n`;
      text += `Edgeها: ${edges?.length || 0}\n\n`;

      if (edges && edges.length > 0) {
        text += "📌 مسیرها:\n";
        edges.forEach((e: any) => {
          text += `• ${e.from_spot_id} → ${e.to_spot_id} (${e.travel_seconds}s)\n`;
        });
      }

      const kb = new InlineKeyboard()
        .text("🔄 Refresh", `adm:dash:${chatId}`)
        .row()
        .text("➕ Spot", `adm:spot:new:${chatId}`)
        .text("➕ Edge", `adm:edge:new:${chatId}`)
        .row()
        .text("🗑 حذف‌ها", `adm:delete:${chatId}`);

      await sendManagedPm(ctx, text, { reply_markup: kb });
      return;
    }

    // ---------------------- ساخت Spot ----------------------
    if (section === "spot") {
      const mode = parts[2];
      const chatId = Number(parts[3]);
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      const region = await getRegionByChat(ctx, chatId);
      if (!region) return sendManagedPm(ctx, "Region وجود ندارد.");

      if (mode === "new") {
        ctx.session.mode = "create_spot";
        ctx.session.pending_region_id = region.id;
        await sendManagedPm(ctx, `اسم Spot جدید را بفرست:`);
        return;
      }
    }

    // ---------------------- ساخت Edge ----------------------
    if (section === "edge") {
      const mode = parts[2];
      const chatId = Number(parts[3]);
      await ctx.answerCallbackQuery();

      const region = await getRegionByChat(ctx, chatId);
      if (!region) {
        await deleteLastPm(ctx);
        return sendManagedPm(ctx, "Region وجود ندارد.");
      }

      // مرحله ۱: انتخاب مبدا
      if (mode === "new") {
        const { data: spots } = await supabase
          .from("spots")
          .select("id,title")
          .eq("region_id", region.id);

        await deleteLastPm(ctx);

        if (!spots || spots.length === 0)
          return sendManagedPm(ctx, "اول Spot بساز.");

        const kb = new InlineKeyboard();
        spots.forEach((s: any) =>
          kb.text(s.title, `adm:edge:from:${chatId}:${s.id}`).row()
        );

        await sendManagedPm(ctx, "Spot مبدا را انتخاب کن:", {
          reply_markup: kb
        });
        return;
      }

      // مرحله ۲: انتخاب مقصد
      if (mode === "from") {
        const fromSpot = parts[4];
        ctx.session.edge_from_spot_id = fromSpot);

        const { data: all } = await supabase
          .from("spots")
          .select("id,title");

        await deleteLastPm(ctx);

        const kb = new InlineKeyboard();
        all.forEach((s: any) =>
          kb.text(s.title, `adm:edge:to:${chatId}:${s.id}`).row()
        );

        await sendManagedPm(ctx, "Spot مقصد را انتخاب کن:", {
          reply_markup: kb
        });
        return;
      }

      // مرحله ۳: وارد کردن زمان سفر
      if (mode === "to") {
        const toSpot = parts[4];
        ctx.session.edge_to_spot_id = toSpot;
        ctx.session.mode = "edge_time";

        await deleteLastPm(ctx);
        return sendManagedPm(ctx, "زمان سفر (ثانیه) را بفرست:");
      }
    }

    // ---------------------- حذف‌ها ----------------------
    if (section === "delete") {
      const chatId = Number(parts[2]);
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      const kb = new InlineKeyboard()
        .text("🗑 حذف Spot", `adm:del:spot:${chatId}`)
        .row()
        .text("🗑 حذف Edge", `adm:del:edge:${chatId}`);

      await sendManagedPm(ctx, "گزینه حذف:", { reply_markup: kb });
      return;
    }

    // ---------------------- انتخاب Spot برای حذف ----------------------
    if (section === "del") {
      const type = parts[2];
      const chatId = Number(parts[3]);

      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      const region = await getRegionByChat(ctx, chatId);
      if (!region) return sendManagedPm(ctx, "Region پیدا نشد.");

      if (type === "spot") {
        const { data: spots } = await supabase
          .from("spots")
          .select("id,title")
          .eq("region_id", region.id);

        if (!spots || spots.length === 0)
          return sendManagedPm(ctx, "Spotی موجود نیست.");

        const kb = new InlineKeyboard();
        spots.forEach((s: any) =>
          kb.text(s.title, `adm:delspot:${s.id}`).row()
        );

        await sendManagedPm(ctx, "کدام Spot حذف شود؟", {
          reply_markup: kb
        });
        return;
      }

      if (type === "edge") {
        const { data: edges } = await supabase
          .from("edges")
          .select("id,from_spot_id,to_spot_id");

        if (!edges || edges.length === 0)
          return sendManagedPm(ctx, "Edgeی موجود نیست.");

        const kb = new InlineKeyboard();
        edges.forEach((e: any) =>
          kb.text(`${e.from_spot_id} → ${e.to_spot_id}`, `adm:deledge:${e.id}`).row()
        );

        await sendManagedPm(ctx, "کدام مسیر حذف شود؟", {
          reply_markup: kb
        });
        return;
      }
    }

    // ---------------------- تأیید حذف Spot ----------------------
    if (section === "delspot") {
      const spotId = parts[2];
      await ctx.answerCallbackQuery();

      const { error } = await supabase
        .from("spots")
        .delete()
        .eq("id", spotId);

      await deleteLastPm(ctx);
      await sendManagedPm(
        ctx,
        error ? "خطا در حذف Spot" : "Spot حذف شد."
      );
      return;
    }

    // ---------------------- تأیید حذف Edge ----------------------
    if (section === "deledge") {
      const edgeId = parts[2];
      await ctx.answerCallbackQuery();

      const { error } = await supabase
        .from("edges")
        .delete()
        .eq("id", edgeId);

      await deleteLastPm(ctx);
      await sendManagedPm(
        ctx,
        error ? "خطا در حذف Edge" : "Edge حذف شد."
      );
      return;
    }

    await next();
  });

  // پیام text برای ساخت Spot + Edge-time
  bot.on("message:text", async (ctx, next) => {
    if (ctx.from?.id !== MASTER_ID) return next();

    const mode = ctx.session.mode;
    const { supabase } = ctx.services;

    if (mode === "create_spot") {
      const regionId = ctx.session.pending_region_id!;
      const name = ctx.message.text.trim();
      const slug = slugify(name);

      const { error } = await supabase
        .from("spots")
        .insert({
          region_id: regionId,
          slug,
          title: name
        });

      ctx.session.mode = undefined;
      ctx.session.pending_region_id = undefined;

      await deleteLastPm(ctx);
      await sendManagedPm(ctx, error ? "خطا در ساخت Spot" : "Spot ساخته شد.");
      return;
    }

    if (mode === "edge_time") {
      const fromId = ctx.session.edge_from_spot_id!;
      const toId = ctx.session.edge_to_spot_id!;
      const t = Number(ctx.message.text.trim());

      const { error } = await supabase.from("edges").insert({
        from_spot_id: fromId,
        to_spot_id: toId,
        travel_seconds: t
      });

      ctx.session.mode = undefined;
      ctx.session.edge_from_spot_id = undefined;
      ctx.session.edge_to_spot_id = undefined;

      await deleteLastPm(ctx);
      await sendManagedPm(ctx, error ? "خطا در ساخت Edge" : "Edge ساخته شد.");
      return;
    }

    return next();
  });
}
