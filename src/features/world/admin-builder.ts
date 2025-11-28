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
    if (ctx.session.__last_pm_id && ctx.from) {
      await ctx.api.deleteMessage(ctx.from.id, ctx.session.__last_pm_id);
    }
  } catch {
    // مهم نیست اگر نتونست پاک کنه
  }
}

// ارسال پیام پنل توی پی‌وی + ذخیره‌ی message_id
async function sendManagedPm(
  ctx: MyContext,
  text: string,
  keyboard?: InlineKeyboard
) {
  if (!ctx.from) return;
  await deleteLastPm(ctx);

  const msg = await ctx.api.sendMessage(ctx.from.id, text, {
    reply_markup: keyboard,
    parse_mode: "HTML",
  });

  ctx.session.__last_pm_id = msg.message_id;
}

/**
 * گرفتن Region بر اساس chat_id گروه
 */
async function getRegionByChatId(ctx: MyContext, chatId: number) {
  const { supabase } = ctx.services;
  const { data, error } = await supabase
    .from("regions")
    .select("*")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  if (error || !data) return null;
  return data as any;
}

/**
 * ساخت Region جدید برای یک گروه
 */
async function ensureRegionForGroup(
  ctx: MyContext,
  chatId: number,
  title: string
) {
  const existing = await getRegionByChatId(ctx, chatId);
  if (existing) return existing;

  const { supabase } = ctx.services;
  const slug = slugify(title || `region-${chatId}`);

  const { data, error } = await supabase
    .from("regions")
    .insert({
      telegram_chat_id: chatId,
      title,
      slug,
    })
    .select("*")
    .single();

  if (error || !data) {
    console.error("ensureRegion insert error:", error);
    throw new Error("خطا در ساخت Region برای این گروه.");
  }

  return data as any;
}

/**
 * ساخت کیبورد اصلی پنل Region
 */
function buildRegionMenu(region: any) {
  const kb = new InlineKeyboard();

  kb
    .text("➕ ساخت Spot جدید", "wa:new_spot")
    .row()
    .text("🧭 ساخت Edge جدید", "wa:new_edge")
    .row()
    .text("🗑 مدیریت / حذف Edge ها", "wa:manage_edges")
    .row()
    .text("🔄 رفرش", "wa:refresh_region");

  const header =
    `🗺 <b>پنل مدیریت نقشه این گروه</b>\n` +
    `Region: <code>${region.title}</code>\n` +
    `Chat ID: <code>${region.telegram_chat_id}</code>`;

  return { header, kb };
}

/**
 * گرفتن همه‌ی Spot های یک Region
 */
async function getSpotsForRegion(ctx: MyContext, regionId: number) {
  const { supabase } = ctx.services;
  const { data, error } = await supabase
    .from("spots")
    .select("id,title")
    .eq("region_id", regionId)
    .order("id", { ascending: true });

  if (error) {
    console.error("getSpotsForRegion error:", error);
    return [];
  }

  return (data || []) as { id: number; title: string }[];
}

/**
 * ساخت کیبورد انتخاب Spot
 */
function buildSpotPickerKeyboard(
  spots: { id: number; title: string }[],
  mode: "from" | "to" | "delete_from"
) {
  const kb = new InlineKeyboard();

  if (spots.length === 0) {
    kb.text("برگشت", "wa:back_region");
    return kb;
  }

  for (const s of spots) {
    let action = "";
    if (mode === "from") action = `wa:edge_from:${s.id}`;
    else if (mode === "to") action = `wa:edge_to:${s.id}`;
    else if (mode === "delete_from") action = `wa:del_from:${s.id}`;

    kb.text(s.title, action).row();
  }

  kb.text("⬅ برگشت", "wa:back_region");
  return kb;
}

/**
 * گرفتن Edge های خروجی از یک Spot
 */
async function getEdgesFromSpot(ctx: MyContext, fromSpotId: number) {
  const { supabase } = ctx.services;

  const { data: edges, error } = await supabase
    .from("edges")
    .select("id,from_spot_id,to_spot_id,travel_seconds")
    .eq("from_spot_id", fromSpotId)
    .order("id", { ascending: true });

  if (error) {
    console.error("getEdgesFromSpot error:", error);
    return [];
  }

  return (edges || []) as {
    id: number;
    from_spot_id: number;
    to_spot_id: number;
    travel_seconds: number;
  }[];
}

/**
 * ساخت کیبورد حذف Edge ها
 */
async function buildDeleteEdgeKeyboard(ctx: MyContext, fromSpotId: number) {
  const edges = await getEdgesFromSpot(ctx, fromSpotId);
  const { supabase } = ctx.services;

  if (edges.length === 0) {
    const kb = new InlineKeyboard();
    kb.text("⬅ برگشت", "wa:back_region");
    return {
      text: "هیچ مسیری از این نقطه ثبت نشده.",
      kb,
    };
  }

  // گرفتن عنوان Spot مقصد برای هر edge
  const toIds = Array.from(new Set(edges.map((e) => e.to_spot_id)));
  const { data: spots, error } = await supabase
    .from("spots")
    .select("id,title")
    .in("id", toIds);

  const titleMap = new Map<number, string>();
  if (!error && spots) {
    for (const s of spots as { id: number; title: string }[]) {
      titleMap.set(s.id, s.title);
    }
  }

  const kb = new InlineKeyboard();

  for (const e of edges) {
    const toTitle = titleMap.get(e.to_spot_id) || `Spot #${e.to_spot_id}`;
    const label = `${toTitle} ~ ${e.travel_seconds}s`;
    kb.text(label, `wa:del_edge:${e.id}`).row();
  }

  kb.text("⬅ برگشت", "wa:back_region");

  return {
    text: "یکی از مسیرها را برای حذف انتخاب کن:",
    kb,
  };
}

/**
 * ثبت فیچر مدیریت نقشه‌ی جهان (World Admin)
 */
export function registerWorldAdminFeature(bot: Bot<MyContext>) {
  // دستور /worldadmin فقط برای ارباب و فقط داخل گروه
  bot.command("worldadmin", async (ctx) => {
    if (!ctx.from) return;

    if (ctx.from.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم می‌تونه پنل نقشه رو باز کنه، حدتو بدون.");
      return;
    }

    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) {
      await ctx.reply(
        "برای مدیریت یک گروه، دستور /worldadmin رو داخل همون گروه بزن.\n" +
          "من پیام دستور رو اونجا پاک می‌کنم و پنل رو توی پی‌ویت باز می‌کنم."
      );
      return;
    }

    const chatId = chat.id;
    const title = chat.title ?? `Group ${chatId}`;

    // حذف پیام دستور در گروه (اگر بشه)
    if (ctx.message) {
      try {
        await ctx.api.deleteMessage(chatId, ctx.message.message_id);
      } catch {
        // مهم نیست
      }
    }

    // اطمینان از وجود Region برای این گروه
    const region = await ensureRegionForGroup(ctx, chatId, title);

    // ذخیره‌ی وضعیت در سشن
    ctx.session.worldAdmin = {
      mode: "idle",
      regionChatId: chatId,
      regionId: region.id,
      fromSpotId: null,
      toSpotId: null,
    };

    // نمایش پنل در پی‌وی ارباب
    const { header, kb } = buildRegionMenu(region);
    await sendManagedPm(ctx, header, kb);
  });

  // هندلر دکمه‌های inline مربوط به wa:*
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery?.data || "";
    if (!data.startsWith("wa:")) {
      await next();
      return;
    }

    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      await ctx.answerCallbackQuery({ text: "فقط ارباب اجازه این کار رو داره." });
      return;
    }

    await ctx.answerCallbackQuery();

    const [_, action, param] = data.split(":");
    const ses = ctx.session.worldAdmin;

    if (!ses || !ses.regionId) {
      await sendManagedPm(ctx, "ابتدا /worldadmin را در یک گروه اجرا کن.");
      return;
    }

    const regionId = ses.regionId;

    switch (action) {
      case "refresh_region": {
        const { supabase } = ctx.services;
        const { data: region, error } = await supabase
          .from("regions")
          .select("*")
          .eq("id", regionId)
          .single();

        if (error || !region) {
          await sendManagedPm(ctx, "Region مربوط به این گروه پیدا نشد.");
          return;
        }

        const { header, kb } = buildRegionMenu(region);
        await sendManagedPm(ctx, header, kb);
        break;
      }

      case "back_region": {
        const { supabase } = ctx.services;
        const { data: region, error } = await supabase
          .from("regions")
          .select("*")
          .eq("id", regionId)
          .single();

        if (error || !region) {
          await sendManagedPm(ctx, "Region مربوط به این گروه پیدا نشد.");
          return;
        }

        ses.mode = "idle";
        ses.fromSpotId = null;
        ses.toSpotId = null;

        const { header, kb } = buildRegionMenu(region);
        await sendManagedPm(ctx, header, kb);
        break;
      }

      case "new_spot": {
        ses.mode = "create_spot";
        await sendManagedPm(
          ctx,
          "نام Spot جدید را بفرست.\n" +
            "مثال: «دروازه شمالی» یا «بازار اصلی»"
        );
        break;
      }

      case "new_edge": {
        const spots = await getSpotsForRegion(ctx, regionId);
        if (spots.length === 0) {
          await sendManagedPm(
            ctx,
            "برای ساخت مسیر، حداقل یک Spot لازم است.\n" +
              "اول یک Spot جدید بساز."
          );
          return;
        }

        ses.mode = "select_edge_from";
        ses.fromSpotId = null;
        ses.toSpotId = null;

        const kb = buildSpotPickerKeyboard(spots, "from");
        await sendManagedPm(ctx, "نقطه‌ی مبدا مسیر را انتخاب کن:", kb);
        break;
      }

      case "edge_from": {
        if (!param) return;
        const fromId = Number(param);
        if (!Number.isFinite(fromId)) return;

        ses.fromSpotId = fromId;
        ses.mode = "select_edge_to";

        const spots = await getSpotsForRegion(ctx, regionId);
        const kb = buildSpotPickerKeyboard(spots, "to");
        await sendManagedPm(ctx, "حالا نقطه‌ی مقصد مسیر را انتخاب کن:", kb);
        break;
      }

      case "edge_to": {
        if (!param) return;
        const toId = Number(param);
        if (!Number.isFinite(toId)) return;

        ses.toSpotId = toId;
        ses.mode = "edge_time";

        await sendManagedPm(
          ctx,
          "زمان سفر این مسیر را به <b>ثانیه</b> بفرست.\nمثال: 300"
        );
        break;
      }

      case "manage_edges": {
        const spots = await getSpotsForRegion(ctx, regionId);
        if (spots.length === 0) {
          await sendManagedPm(ctx, "هیچ Spotی برای این Region ثبت نشده.");
          return;
        }

        ses.mode = "delete_from";
        const kb = buildSpotPickerKeyboard(spots, "delete_from");
        await sendManagedPm(
          ctx,
          "از کدام نقطه می‌خواهی مسیرهای خروجی را مدیریت کنی؟",
          kb
        );
        break;
      }

      case "del_from": {
        if (!param) return;
        const fromId = Number(param);
        if (!Number.isFinite(fromId)) return;

        ses.mode = "delete_from";
        ses.fromSpotId = fromId;

        const { text, kb } = await buildDeleteEdgeKeyboard(ctx, fromId);
        await sendManagedPm(ctx, text, kb);
        break;
      }

      case "del_edge": {
        if (!param) return;
        const edgeId = Number(param);
        if (!Number.isFinite(edgeId)) return;

        const { supabase } = ctx.services;
        const { error } = await supabase
          .from("edges")
          .delete()
          .eq("id", edgeId);

        if (error) {
          console.error("delete edge error:", error);
          await sendManagedPm(ctx, "در حذف مسیر خطایی رخ داد.");
          return;
        }

        // بعد از حذف، اگر fromSpotId داریم، لیست رو رفرش کن
        if (ses.fromSpotId) {
          const { text, kb } = await buildDeleteEdgeKeyboard(
            ctx,
            ses.fromSpotId
          );
          await sendManagedPm(ctx, "مسیر حذف شد.\n\n" + text, kb);
        } else {
          await sendManagedPm(ctx, "مسیر حذف شد.");
        }
        break;
      }

      default: {
        // ناشناخته
        await next();
      }
    }
  });

  // هندل کردن پیام‌های متنی توی پی‌وی برای مراحل ساخت Spot و Edge time
  bot.on("message:text", async (ctx, next) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      await next();
      return;
    }

    if (ctx.chat?.type !== "private") {
      await next();
      return;
    }

    const ses = ctx.session.worldAdmin;
    if (!ses || !ses.regionId || !ses.mode || ses.mode === "idle") {
      await next();
      return;
    }

    const regionId = ses.regionId;
    const text = ctx.message.text.trim();
    const { supabase } = ctx.services;

    if (ses.mode === "create_spot") {
      if (!text) {
        await sendManagedPm(ctx, "نام Spot نمی‌تواند خالی باشد.");
        return;
      }

      const slug = slugify(text);

      const { error } = await supabase.from("spots").insert({
        region_id: regionId,
        title: text,
        slug,
      });

      if (error) {
        console.error("insert spot error:", error);
        await sendManagedPm(ctx, "در ساخت Spot خطایی رخ داد.");
        return;
      }

      ses.mode = "idle";

      const { data: region, error: regErr } = await supabase
        .from("regions")
        .select("*")
        .eq("id", regionId)
        .single();

      if (regErr || !region) {
        await sendManagedPm(ctx, "Spot ساخته شد، اما Region دوباره پیدا نشد.");
        return;
      }

      const { header, kb } = buildRegionMenu(region);
      await sendManagedPm(ctx, "Spot جدید ثبت شد.\n\n" + header, kb);
      return;
    }

    if (ses.mode === "edge_time") {
      if (!ses.fromSpotId || !ses.toSpotId) {
        ses.mode = "idle";
        await sendManagedPm(ctx, "اطلاعات مبدا/مقصد کامل نبود. دوباره تلاش کن.");
        return;
      }

      const seconds = Number(text);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        await sendManagedPm(
          ctx,
          "زمان سفر باید یک عدد صحیح مثبت (به ثانیه) باشد."
        );
        return;
      }

      const { error } = await supabase.from("edges").insert({
        from_spot_id: ses.fromSpotId,
        to_spot_id: ses.toSpotId,
        travel_seconds: seconds,
      });

      if (error) {
        console.error("insert edge error:", error);
        await sendManagedPm(ctx, "در ساخت مسیر خطایی رخ داد.");
        return;
      }

      ses.mode = "idle";
      ses.fromSpotId = null;
      ses.toSpotId = null;

      const { data: region, error: regErr } = await supabase
        .from("regions")
        .select("*")
        .eq("id", regionId)
        .single();

      if (regErr || !region) {
        await sendManagedPm(ctx, "مسیر ثبت شد، اما Region دوباره پیدا نشد.");
        return;
      }

      const { header, kb } = buildRegionMenu(region);
      await sendManagedPm(
        ctx,
        `مسیر جدید ثبت شد.\nزمان سفر: ${Math.floor(seconds)} ثانیه.\n\n` +
          header,
        kb
      );
      return;
    }

    // اگر mode چیز دیگری بود، فعلاً نادیده بگیر
    await next();
  });
}
