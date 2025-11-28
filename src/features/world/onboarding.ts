// src/features/world/admin-builder.ts
import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

type WorldAdminMode =
  | "idle"
  | "creating_spot"
  | "select_edge_from"
  | "select_edge_to"
  | "input_edge_time";

interface WorldAdminSession {
  mode: WorldAdminMode;
  regionChatId: number | null;
  regionId: number | null;
  fromSpotId: number | null;
  toSpotId: number | null;
}

/**
 * سشن پنل ادمین را از ctx.session برمی‌داریم/می‌سازیم
 */
function getAdminSession(ctx: MyContext): WorldAdminSession {
  const s = (ctx.session as any);
  if (!s.worldAdmin) {
    s.worldAdmin = {
      mode: "idle",
      regionChatId: null,
      regionId: null,
      fromSpotId: null,
      toSpotId: null,
    } as WorldAdminSession;
  }
  return s.worldAdmin as WorldAdminSession;
}

function setAdminSession(ctx: MyContext, patch: Partial<WorldAdminSession>): void {
  const s = (ctx.session as any);
  const base: WorldAdminSession = getAdminSession(ctx);
  s.worldAdmin = { ...base, ...patch };
}

/**
 * کیبورد اصلی پنل /worldadmin
 */
function buildAdminMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📍 اطلاعات Region", "wa:info")
    .row()
    .text("➕ ساخت Spot", "wa:spot_new")
    .text("🗺 لیست Spotها", "wa:spots")
    .row()
    .text("🔗 ساخت مسیر (Edge)", "wa:edge_new")
    .text("🧵 لیست مسیرها", "wa:edges")
    .row()
    .text("🔄 بازگشت به منوی پنل", "wa:home");
}

/**
 * گرفتن Region فعلی بر اساس chat_id ذخیره‌شده در سشن
 */
async function getCurrentRegion(ctx: MyContext): Promise<any | null> {
  const { supabase } = ctx.services;
  const admin = getAdminSession(ctx);
  const regionChatId = admin.regionChatId;

  if (!regionChatId) {
    await ctx.reply(
      "هنوز هیچ گروهی برای مدیریت انتخاب نشده.\n" +
        "از داخل گروه موردنظر، /worldadmin را اجرا کن."
    );
    return null;
  }

  const { data, error } = await supabase
    .from("regions")
    .select("*")
    .eq("telegram_chat_id", regionChatId)
    .maybeSingle();

  if (error || !data) {
    console.error("getCurrentRegion error:", error);
    await ctx.reply(
      "Region مربوط به این گروه در دیتابیس پیدا نشد.\n" +
        "یک بار دیگر در همان گروه /worldadmin را اجرا کن."
    );
    return null;
  }

  return data;
}

/**
 * نشان‌دادن پنل اصلی در پی‌وی ارباب
 */
async function sendAdminHome(ctx: MyContext, extra?: string): Promise<void> {
  const admin = getAdminSession(ctx);
  const regionChatId = admin.regionChatId;

  let header = "🔧 پنل مدیریت جهان اکلیس\n\n";

  if (regionChatId) {
    header += `گروه در حال مدیریت: ${regionChatId}\n`;
  }

  if (extra) {
    header += `\n${extra}`;
  }

  await ctx.reply(header, {
    reply_markup: buildAdminMainKeyboard(),
  });
}

/**
 * /worldadmin — فقط ارباب، فقط داخل گروه
 * Region را با اسم گروه می‌سازد/آپدیت می‌کند و پنل را در پی‌وی باز می‌کند
 */
function registerWorldAdminCommand(bot: Bot<MyContext>): void {
  bot.command("worldadmin", async (ctx) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم می‌تونه پنل جهان را باز کند، حدتو نگه دار.");
      return;
    }

    if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) {
      await ctx.reply("این ورد را فقط باید داخل گروه مربوط به یک منطقه اجرا کنی.");
      return;
    }

    const { supabase } = ctx.services;
    const chatId = ctx.chat.id;
    const chatTitle = ctx.chat.title || "بدون‌نام";

    // سعی می‌کنیم پیام دستور را پاک کنیم
    try {
      await ctx.deleteMessage();
    } catch {
      // اگر نشد، مهم نیست
    }

    // Region را برای این گروه بساز / آپدیت کن
    let regionId: number | null = null;

    const { data: existing, error: regErr } = await supabase
      .from("regions")
      .select("id")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();

    if (!regErr && existing) {
      // آپدیت عنوان با نام گروه
      const { data: upd, error: updErr } = await supabase
        .from("regions")
        .update({ title: chatTitle })
        .eq("telegram_chat_id", chatId)
        .select("id")
        .single();

      if (!updErr && upd) {
        regionId = upd.id;
      } else {
        regionId = existing.id;
      }
    } else {
      // ساخت Region جدید
      const { data: ins, error: insErr } = await supabase
        .from("regions")
        .insert({
          title: chatTitle,
          telegram_chat_id: chatId,
        })
        .select("id")
        .single();

      if (insErr || !ins) {
        console.error("create region error:", insErr);
        await ctx.reply("در ساخت Region برای این گروه مشکلی پیش آمد.");
        return;
      }
      regionId = ins.id;
    }

    // ذخیره در سشن
    setAdminSession(ctx, {
      regionChatId: chatId,
      regionId,
      mode: "idle",
      fromSpotId: null,
      toSpotId: null,
    });

    const text =
      "🔧 پنل مدیریت جهان برای این گروه باز شد.\n\n" +
      `نام گروه: ${chatTitle}\n` +
      `chat_id: ${chatId}\n\n` +
      "از دکمه‌های زیر برای ساخت Spot و مسیرها استفاده کن.";

    try {
      await ctx.api.sendMessage(ctx.from.id, text, {
        reply_markup: buildAdminMainKeyboard(),
      });
    } catch (err) {
      console.error("send PM worldadmin error:", err);
      await ctx.reply(
        "نتوانستم در پی‌وی پیام بفرستم. ابتدا ربات را در پی‌وی استارت کن."
      );
    }
  });
}

/**
 * نمایش اطلاعات کلی Region
 */
async function handleRegionInfo(ctx: MyContext): Promise<void> {
  const { supabase } = ctx.services;
  const region = await getCurrentRegion(ctx);
  if (!region) return;

  const regionId = region.id as number;
  const regionTitle = region.title as string;

  const { data: spots, error: spotsErr } = await supabase
    .from("spots")
    .select("id")
    .eq("region_id", regionId);

  let edgeCount = 0;

  if (!spotsErr && spots && spots.length > 0) {
    const spotIds = (spots as any[]).map((s) => s.id);
    const { data: edges, error: edgesErr } = await supabase
      .from("edges")
      .select("id")
      .in("from_spot_id", spotIds);

    if (!edgesErr && edges) {
      edgeCount = edges.length;
    } else if (edgesErr) {
      console.error("edges count error:", edgesErr);
    }
  }

  if (spotsErr) {
    console.error("spots count error:", spotsErr);
  }

  const spotCount = spots ? spots.length : 0;

  const text =
    `📍 اطلاعات Region فعلی:\n\n` +
    `نام: ${regionTitle}\n` +
    `شناسه داخلی: ${regionId}\n\n` +
    `تعداد Spotها: ${spotCount}\n` +
    `تعداد مسیرها (Edgeها): ${edgeCount}`;

  await ctx.reply(text, { reply_markup: buildAdminMainKeyboard() });
}

/**
 * شروع ساخت Spot جدید
 */
async function handleSpotNew(ctx: MyContext): Promise<void> {
  const region = await getCurrentRegion(ctx);
  if (!region) return;

  setAdminSession(ctx, { mode: "creating_spot" });

  await ctx.reply(
    "برای ساخت Spot جدید، نام آن را به‌صورت یک پیام متنی بفرست.\n" +
      "مثال:\n" +
      "میدان اتریل سیلوا"
  );
}

/**
 * لیست Spotها
 */
async function handleSpotList(ctx: MyContext): Promise<void> {
  const { supabase } = ctx.services;
  const region = await getCurrentRegion(ctx);
  if (!region) return;

  const regionId = region.id as number;

  const { data: spots, error } = await supabase
    .from("spots")
    .select("id,title")
    .eq("region_id", regionId)
    .order("id", { ascending: true });

  if (error) {
    console.error("spots list error:", error);
    await ctx.reply("در گرفتن لیست Spotها مشکلی پیش آمد.");
    return;
  }

  if (!spots || spots.length === 0) {
    await ctx.reply(
      "برای این Region هنوز هیچ Spotی ثبت نشده.\n" +
        "از «➕ ساخت Spot» برای ساخت نقطه‌ی جدید استفاده کن.",
      { reply_markup: buildAdminMainKeyboard() }
    );
    return;
  }

  let text = "🗺 لیست Spotهای این Region:\n\n";
  for (const s of spots as any[]) {
    text += `• [${s.id}] ${s.title}\n`;
  }

  await ctx.reply(text, { reply_markup: buildAdminMainKeyboard() });
}

/**
 * شروع ساخت Edge (انتخاب مبدا)
 */
async function handleEdgeNew(ctx: MyContext): Promise<void> {
  const { supabase } = ctx.services;
  const region = await getCurrentRegion(ctx);
  if (!region) return;

  const regionId = region.id as number;

  const { data: spots, error } = await supabase
    .from("spots")
    .select("id,title")
    .eq("region_id", regionId)
    .order("id", { ascending: true });

  if (error) {
    console.error("spots list for edge error:", error);
    await ctx.reply("در گرفتن لیست Spotها برای ساخت مسیر مشکلی پیش آمد.");
    return;
  }

  if (!spots || spots.length === 0) {
    await ctx.reply(
      "برای این Region هنوز Spotی تعریف نشده.\n" +
        "ابتدا یک Spot بساز، بعد دوباره برای ساخت Edge تلاش کن.",
      { reply_markup: buildAdminMainKeyboard() }
    );
    return;
  }

  setAdminSession(ctx, {
    mode: "select_edge_from",
    fromSpotId: null,
    toSpotId: null,
    regionChatId: getAdminSession(ctx).regionChatId,
    regionId: getAdminSession(ctx).regionId,
  });

  const kb = new InlineKeyboard();
  for (const s of spots as any[]) {
    kb.text(s.title, `wa:edge_from:${s.id}`).row();
  }
  kb.text("🔙 بازگشت", "wa:home");

  await ctx.reply("برای ساخت مسیر جدید، ابتدا Spot مبدا را انتخاب کن:", {
    reply_markup: kb,
  });
}

/**
 * انتخاب Spot مبدا
 */
async function handleEdgeSelectFrom(ctx: MyContext, spotId: number): Promise<void> {
  const { supabase } = ctx.services;
  const region = await getCurrentRegion(ctx);
  if (!region) return;

  const regionId = region.id as number;

  const { data: spots, error } = await supabase
    .from("spots")
    .select("id,title")
    .eq("region_id", regionId)
    .order("id", { ascending: true });

  if (error) {
    console.error("spots list for edge (to) error:", error);
    await ctx.reply("در گرفتن لیست Spotها برای انتخاب مقصد مشکلی پیش آمد.");
    return;
  }

  if (!spots || spots.length === 0) {
    await ctx.reply("Spotی برای این Region یافت نشد.");
    return;
  }

  setAdminSession(ctx, {
    mode: "select_edge_to",
    fromSpotId: spotId,
    toSpotId: null,
  });

  const kb = new InlineKeyboard();
  for (const s of spots as any[]) {
    if (s.id === spotId) continue;
    kb.text(s.title, `wa:edge_to:${s.id}`).row();
  }
  kb.text("🔙 بازگشت", "wa:home");

  await ctx.editMessageText("حالا Spot مقصد را انتخاب کن:", {
    reply_markup: kb,
  });
}

/**
 * انتخاب Spot مقصد
 */
async function handleEdgeSelectTo(ctx: MyContext, spotId: number): Promise<void> {
  const admin = getAdminSession(ctx);
  const fromSpotId = admin.fromSpotId;

  if (!fromSpotId) {
    await ctx.reply("اطلاعات مبدا مسیر گم شده. دوباره ساخت مسیر را آغاز کن.");
    return;
  }

  setAdminSession(ctx, {
    mode: "input_edge_time",
    toSpotId: spotId,
  });

  await ctx.reply(
    "مدت زمان سفر بین این دو نقطه را به ثانیه بفرست.\n" +
      "مثال: 60\n" +
      "یا: 300"
  );
}

/**
 * لیست Edgeها
 */
async function handleEdgeList(ctx: MyContext): Promise<void> {
  const { supabase } = ctx.services;
  const region = await getCurrentRegion(ctx);
  if (!region) return;

  const regionId = region.id as number;

  const { data: spots, error: spotsErr } = await supabase
    .from("spots")
    .select("id,title")
    .eq("region_id", regionId)
    .order("id", { ascending: true });

  if (spotsErr) {
    console.error("spots for edges list error:", spotsErr);
    await ctx.reply("در گرفتن Spotها برای لیست مسیرها مشکلی پیش آمد.");
    return;
  }

  if (!spots || spots.length === 0) {
    await ctx.reply(
      "برای این Region هنوز Spotی تعریف نشده؛ در نتیجه مسیری هم وجود ندارد.",
      { reply_markup: buildAdminMainKeyboard() }
    );
    return;
  }

  const spotMap = new Map<number, string>();
  const spotIds: number[] = [];
  for (const s of spots as any[]) {
    spotMap.set(s.id, s.title);
    spotIds.push(s.id);
  }

  const { data: edges, error: edgesErr } = await supabase
    .from("edges")
    .select("id,from_spot_id,to_spot_id,travel_seconds")
    .in("from_spot_id", spotIds);

  if (edgesErr) {
    console.error("edges list error:", edgesErr);
    await ctx.reply("در گرفتن لیست مسیرها مشکلی پیش آمد.");
    return;
  }

  if (!edges || edges.length === 0) {
    await ctx.reply("برای این Region هنوز هیچ مسیری ساخته نشده.", {
      reply_markup: buildAdminMainKeyboard(),
    });
    return;
  }

  let text = "🧵 لیست مسیرهای این Region:\n\n";
  for (const e of edges as any[]) {
    const fromName = spotMap.get(e.from_spot_id) || `Spot ${e.from_spot_id}`;
    const toName = spotMap.get(e.to_spot_id) || `Spot ${e.to_spot_id}`;
    text += `• [${e.id}] ${fromName} → ${toName} · ${e.travel_seconds} ثانیه\n`;
  }

  await ctx.reply(text, { reply_markup: buildAdminMainKeyboard() });
}

/**
 * هندل پیام‌های متنی در پی‌وی ارباب (ساخت Spot و زمان Edge)
 */
function registerAdminTextHandlers(bot: Bot<MyContext>): void {
  bot.on("message:text", async (ctx, next) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      return next();
    }

    if (!ctx.chat || ctx.chat.type !== "private") {
      return next();
    }

    const admin = getAdminSession(ctx);
    const mode = admin.mode;
    const { supabase } = ctx.services;
    const region = await getCurrentRegion(ctx);
    if (!region) return;

    const regionId = region.id as number;
    const text = ctx.message.text.trim();

    if (mode === "creating_spot") {
      if (!text) {
        await ctx.reply("نام Spot نمی‌تواند خالی باشد.");
        return;
      }

      const { error: insErr } = await supabase.from("spots").insert({
        title: text,
        region_id: regionId,
      });

      if (insErr) {
        console.error("create spot error:", insErr);
        await ctx.reply("در ساخت Spot جدید مشکلی پیش آمد.");
        return;
      }

      setAdminSession(ctx, { mode: "idle" });

      await ctx.reply(`Spot جدید ساخته شد: ${text}`, {
        reply_markup: buildAdminMainKeyboard(),
      });
      return;
    }

    if (mode === "input_edge_time") {
      const adminState = getAdminSession(ctx);
      const fromSpotId = adminState.fromSpotId;
      const toSpotId = adminState.toSpotId;

      if (!fromSpotId || !toSpotId) {
        await ctx.reply("اطلاعات مسیر ناقص است. ساخت مسیر را دوباره شروع کن.");
        setAdminSession(ctx, { mode: "idle", fromSpotId: null, toSpotId: null });
        return;
      }

      const seconds = Number(text);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        await ctx.reply("مدت زمان سفر باید یک عدد مثبت (به ثانیه) باشد.");
        return;
      }

      const { error: insErr } = await supabase.from("edges").insert({
        from_spot_id: fromSpotId,
        to_spot_id: toSpotId,
        travel_seconds: seconds,
      });

      if (insErr) {
        console.error("create edge error:", insErr);
        await ctx.reply("در ساخت مسیر جدید مشکلی پیش آمد.");
        return;
      }

      setAdminSession(ctx, {
        mode: "idle",
        fromSpotId: null,
        toSpotId: null,
      });

      await ctx.reply(`مسیر جدید با زمان ${seconds} ثانیه ثبت شد.`, {
        reply_markup: buildAdminMainKeyboard(),
      });
      return;
    }

    return next();
  });
}

/**
 * هندل callback_query های wa:...
 */
function registerAdminCallbacks(bot: Bot<MyContext>): void {
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";

    if (!data.startsWith("wa:")) {
      return next();
    }

    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      await ctx.answerCallbackQuery();
      await ctx.reply("این پنل فقط برای ارباب من است.");
      return;
    }

    await ctx.answerCallbackQuery();

    const parts = data.split(":");
    const action = parts[1];

    if (!ctx.chat || ctx.chat.type !== "private") {
      await ctx.reply("پنل مدیریت جهان فقط در پی‌وی کار می‌کند.");
      return;
    }

    switch (action) {
      case "home":
        setAdminSession(ctx, { mode: "idle" });
        await sendAdminHome(ctx, "به پنل اصلی برگشتی.");
        break;

      case "info":
        await handleRegionInfo(ctx);
        break;

      case "spot_new":
        await handleSpotNew(ctx);
        break;

      case "spots":
        await handleSpotList(ctx);
        break;

      case "edge_new":
        await handleEdgeNew(ctx);
        break;

      case "edges":
        await handleEdgeList(ctx);
        break;

      case "edge_from": {
        const spotId = Number(parts[2]);
        if (!Number.isFinite(spotId)) return;
        await handleEdgeSelectFrom(ctx, spotId);
        break;
      }

      case "edge_to": {
        const spotId = Number(parts[2]);
        if (!Number.isFinite(spotId)) return;
        await handleEdgeSelectTo(ctx, spotId);
        break;
      }

      default:
        break;
    }
  });
}

/**
 * رجیستر کل فیچر admin-builder
 */
export function registerWorldAdminFeature(bot: Bot<MyContext>): void {
  registerWorldAdminCommand(bot);
  registerAdminTextHandlers(bot);
  registerAdminCallbacks(bot);
}

// برای سازگاری با اسم قدیمی
export const registerWorldAdminBuilder = registerWorldAdminFeature;
