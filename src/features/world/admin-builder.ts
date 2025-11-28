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
  } catch {
    // اگر نشد پاک کنیم مهم نیست
  }
  ctx.session.__last_pm_id = undefined;
}

// فرستادن پیام مدیریتی و ذخیره کردن ID برای پاک‌سازی بعدی
async function sendManagedPm(
  ctx: MyContext,
  text: string,
  extra: Parameters<MyContext["reply"]>[1] = {}
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
    .single()
    .catch(() => ({ data: null, error: null } as any));

  if (!data || error) return null;
  return data;
}

export function registerWorldAdminFeature(bot: Bot<MyContext>) {
  // دستور اصلی /worldadmin
  bot.command("worldadmin", async (ctx) => {
    if (ctx.from?.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم میتونه بهم دستور بده، حدتو بدون");
      return;
    }

    const chat = ctx.chat;
    if (!chat) return;

    // اگر توی PV اجرا شد
    if (chat.type === "private") {
      await ctx.reply(
        "برای مدیریت یک گروه، دستور /worldadmin رو داخل همون گروه بفرست.\n" +
          "من پیام دستور رو پاک می‌کنم و پنل مدیریت رو توی پی‌ویت باز می‌کنم."
      );
      return;
    }

    const chatId = chat.id;
    const title = chat.title ?? `Group ${chatId}`;

    // حذف پیام دستور توی گروه
    if (ctx.message) {
      try {
        await ctx.api.deleteMessage(chatId, ctx.message.message_id);
      } catch {
        // اگر پرمیشن نداشتیم، رد می‌شیم
      }
    }

    // فرستادن پنل به PM ارباب
    const kb = new InlineKeyboard()
      .text("📍 ثبت Region برای این چت", `adm:r:new:${chatId}`)
      .row()
      .text("🗂 داشبورد Region", `adm:dash:${chatId}`)
      .row()
      .text("➕ ساخت Spot", `adm:spot:new:${chatId}`)
      .row()
      .text("🔗 ساخت مسیر (Edge)", `adm:edge:new:${chatId}`)
      .row()
      .text("🗑 حذف Spot/Edge", `adm:delete:${chatId}`);

    await ctx.api.sendMessage(
      MASTER_ID,
      `پنل مدیریت برای گروه:\n«${title}» (chat_id: ${chatId})`,
      { reply_markup: kb }
    );
  });

  // هندل دکمه‌ها
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    if (!data.startsWith("adm:")) {
      await next();
      return;
    }

    if (ctx.from?.id !== MASTER_ID) {
      await ctx.answerCallbackQuery({
        text: "فقط اربابم میتونه منو کنترل کنه، حدتو بدون",
        show_alert: true,
      });
      return;
    }

    const { supabase } = ctx.services;
    const parts = data.split(":"); // adm:...
    const section = parts[1];

    // ---- ثبت Region ----
    if (section === "r") {
      const mode = parts[2]; // new
      const chatId = Number(parts[3]);
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      if (mode === "new") {
        const { data: region, error } = await supabase
          .from("regions")
          .select("*")
          .eq("telegram_chat_id", chatId)
          .single()
          .catch(() => ({ data: null, error: null } as any));

        if (region && !error) {
          await sendManagedPm(
            ctx,
            `Region قبلاً ثبت شده:\n${region.title} (id: ${region.id})`
          );
          return;
        }

        const title = `Region ${chatId}`;
        const slug = slugify(title);

        const { data: newRegion, error: insErr } = await supabase
          .from("regions")
          .insert({
            slug,
            title,
            telegram_chat_id: chatId,
          })
          .select("*")
          .single();

        if (insErr || !newRegion) {
          await sendManagedPm(ctx, "خطا در ساخت Region.");
          return;
        }

        await sendManagedPm(
          ctx,
          `Region جدید ساخته شد:\n${newRegion.title} (id: ${newRegion.id})`
        );
        return;
      }
    }

    // ---- داشبورد Region ----
    if (section === "dash") {
      const chatId = Number(parts[2]);
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      const region = await getRegionByChat(ctx, chatId);
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

      let edges: any[] = [];
      if (spots && spots.length > 0) {
        const spotIds = spots.map((s: any) => s.id);
        const { data: edgeRows, error: edErr } = await supabase
          .from("edges")
          .select("id,from_spot_id,to_spot_id,travel_seconds")
          .in("from_spot_id", spotIds);

        if (!edErr && edgeRows) edges = edgeRows;
      }

      const kb = new InlineKeyboard()
        .text("🔄 Refresh", `adm:dash:${chatId}`)
        .row()
        .text("➕ Spot", `adm:spot:new:${chatId}`)
        .text("➕ Edge", `adm:edge:new:${chatId}`)
        .row()
        .text("🗑 حذف‌ها", `adm:delete:${chatId}`);

      let text = `📍 داشبورد Region\n${region.title}\n\n`;
      text += `Spotها: ${spots?.length ?? 0}\n`;
      text += `Edgeها: ${edges.length}\n\n`;

      if (edges.length > 0) {
        text += "📌 مسیرها:\n";
        edges.forEach((e) => {
          text += `• ${e.from_spot_id} ➝ ${e.to_spot_id} (${e.travel_seconds}s)\n`;
        });
      }

      await sendManagedPm(ctx, text.trim(), { reply_markup: kb });
      return;
    }

    // ---- ساخت Spot ----
    if (section === "spot") {
      const mode = parts[2]; // new
      const chatId = Number(parts[3]);
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      const region = await getRegionByChat(ctx, chatId);
      if (!region) {
        await sendManagedPm(ctx, "Region برای این چت پیدا نشد. اول Region بساز.");
        return;
      }

      if (mode === "new") {
        ctx.session.mode = "create_spot";
        ctx.session.pending_region_id = region.id;

        await sendManagedPm(
          ctx,
          `Region هدف: ${region.title}\n\nاسم Spot جدید را بفرست:`
        );
        return;
      }
    }

    // ---- ساخت Edge (سه مرحله: new / from / to) ----
    if (section === "edge") {
      const mode = parts[2]; // new / from / to
      const chatId = Number(parts[3]);
      await ctx.answerCallbackQuery();

      const region = await getRegionByChat(ctx, chatId);
      if (!region) {
        await deleteLastPm(ctx);
        await sendManagedPm(ctx, "Region برای این چت ثبت نشده.");
        return;
      }

      // مرحله ۱: new → انتخاب Spot مبدا فقط از همین Region
      if (mode === "new") {
        const { data: fromSpots, error: spErr } = await supabase
          .from("spots")
          .select("id,title")
          .eq("region_id", region.id);

        await deleteLastPm(ctx);

        if (spErr || !fromSpots || fromSpots.length === 0) {
          await sendManagedPm(
            ctx,
            "برای ساخت مسیر، اول باید حداقل یک Spot در این Region بسازی."
          );
          return;
        }

        const kb = new InlineKeyboard();
        fromSpots.forEach((s: any) => {
          kb.text(s.title, `adm:edge:from:${chatId}:${s.id}`).row();
        });

        await sendManagedPm(ctx, "Spot مبدا را انتخاب کن:", {
          reply_markup: kb,
        });
        return;
      }

      // مرحله ۲: انتخاب مبدا → ذخیره در سشن و انتخاب مقصد (از تمام Spotها)
      if (mode === "from") {
        const fromSpotId = parts[4];
        ctx.session.edge_from_spot_id = fromSpotId;
        ctx.session.edge_to_spot_id = undefined;

        const { data: allSpots, error: allErr } = await supabase
          .from("spots")
          .select("id,title");

        await deleteLastPm(ctx);

        if (allErr || !allSpots || allSpots.length === 0) {
          await sendManagedPm(ctx, "هیچ Spotی در جهان ثبت نشده.");
          return;
        }

        const kb = new InlineKeyboard();
        allSpots.forEach((s: any) => {
          kb.text(s.title, `adm:edge:to:${chatId}:${s.id}`).row();
        });

        await sendManagedPm(ctx, "حالا Spot مقصد را انتخاب کن:", {
          reply_markup: kb,
        });
        return;
      }

      // مرحله ۳: انتخاب مقصد → رفتن به حالت گرفتن زمان سفر
      if (mode === "to") {
        const toSpotId = parts[4];
        ctx.session.edge_to_spot_id = toSpotId;
        ctx.session.mode = "edge_time";

        await deleteLastPm(ctx);
        await sendManagedPm(
          ctx,
          "زمان سفر (به ثانیه) را به‌صورت عدد بفرست.\nمثال: 60"
        );
        return;
      }
    }

    // ---- منوی حذف ----
    if (section === "delete") {
      const chatId = Number(parts[2]);
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      const kb = new InlineKeyboard()
        .text("🗑 حذف Spot", `adm:del:spot:${chatId}`)
        .row()
        .text("🗑 حذف Edge", `adm:del:edge:${chatId}`);

      await sendManagedPm(ctx, "منوی حذف:", { reply_markup: kb });
      return;
    }

    // ---- لیست حذف Spot / Edge ----
    if (section === "del") {
      const type = parts[2]; // spot / edge
      const chatId = Number(parts[3]);
      await ctx.answerCallbackQuery();
      await deleteLastPm(ctx);

      const region = await getRegionByChat(ctx, chatId);
      if (!region) {
        await sendManagedPm(ctx, "Region برای این چت ثبت نشده.");
        return;
      }

      if (type === "spot") {
        const { data: spots, error: spErr } = await supabase
          .from("spots")
          .select("id,title")
          .eq("region_id", region.id);

        if (spErr || !spots || spots.length === 0) {
          await sendManagedPm(ctx, "Spotی برای این Region ثبت نشده.");
          return;
        }

        const kb = new InlineKeyboard();
        spots.forEach((s: any) => {
          kb.text(s.title, `adm:delspot:${s.id}`).row();
        });

        await sendManagedPm(ctx, "کدام Spot حذف شود؟", { reply_markup: kb });
        return;
      }

      if (type === "edge") {
        // فقط Edgeهایی که from_spot_idشان در این Region است
        const { data: spots } = await supabase
          .from("spots")
          .select("id")
          .eq("region_id", region.id);

        if (!spots || spots.length === 0) {
          await sendManagedPm(ctx, "هیچ Spotی در این Region نیست.");
          return;
        }

        const spotIds = spots.map((s: any) => s.id);

        const { data: edges } = await supabase
          .from("edges")
          .select("id,from_spot_id,to_spot_id,travel_seconds")
          .in("from_spot_id", spotIds);

        if (!edges || edges.length === 0) {
          await sendManagedPm(ctx, "هیچ Edgeی برای این Region ثبت نشده.");
          return;
        }

        const kb = new InlineKeyboard();
        edges.forEach((e: any) => {
          kb.text(
            `${e.from_spot_id} → ${e.to_spot_id} (${e.travel_seconds}s)`,
            `adm:deledge:${e.id}`
          ).row();
        });

        await sendManagedPm(ctx, "کدام Edge حذف شود؟", {
          reply_markup: kb,
        });
        return;
      }
    }

    // ---- تأیید حذف Spot ----
    if (section === "delspot") {
      const spotId = parts[2];
      await ctx.answerCallbackQuery();

      const { supabase } = ctx.services;
      const { error } = await supabase.from("spots").delete().eq("id", spotId);

      await deleteLastPm(ctx);
      await sendManagedPm(
        ctx,
        error ? "خطا در حذف Spot." : "Spot با موفقیت حذف شد."
      );
      return;
    }

    // ---- تأیید حذف Edge ----
    if (section === "deledge") {
      const edgeId = parts[2];
      await ctx.answerCallbackQuery();

      const { supabase } = ctx.services;
      const { error } = await supabase.from("edges").delete().eq("id", edgeId);

      await deleteLastPm(ctx);
      await sendManagedPm(
        ctx,
        error ? "خطا در حذف Edge." : "Edge با موفقیت حذف شد."
      );
      return;
    }

    await next();
  });

  // پیام متنی برای ساخت Spot و Edge-time
  bot.on("message:text", async (ctx, next) => {
    if (ctx.from?.id !== MASTER_ID) {
      await next();
      return;
    }

    const mode = ctx.session.mode;
    const { supabase } = ctx.services;

    // ساخت Spot
    if (mode === "create_spot") {
      const regionId = ctx.session.pending_region_id;
      if (!regionId) {
        ctx.session.mode = undefined;
        await deleteLastPm(ctx);
        await sendManagedPm(ctx, "Region مشخص نبود. دوباره /worldadmin رو بزن.");
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
        title: name,
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

    // تنظیم زمان Edge
    if (mode === "edge_time") {
      const fromId = ctx.session.edge_from_spot_id;
      const toId = ctx.session.edge_to_spot_id;

      if (!fromId || !toId) {
        ctx.session.mode = undefined;
        await deleteLastPm(ctx);
        await sendManagedPm(
          ctx,
          "مبدا یا مقصد مشخص نیست. دوباره از ساخت Edge شروع کن."
        );
        return;
      }

      const text = ctx.message.text.trim();
      const t = Number(text);

      if (!Number.isFinite(t) || t < 0) {
        await deleteLastPm(ctx);
        await sendManagedPm(ctx, "زمان سفر باید عدد مثبت (ثانیه) باشد. مثال: 60");
        return;
      }

      const { error } = await supabase.from("edges").insert({
        from_spot_id: fromId,
        to_spot_id: toId,
        travel_seconds: Math.floor(t),
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
