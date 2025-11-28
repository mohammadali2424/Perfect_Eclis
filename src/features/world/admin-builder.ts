// src/features/world/admin-builder.ts
import type { EclisContext } from "../../core/bot.js";
import { isOwner, rejectNonOwner } from "../../core/bot.js";
import { supabase } from "../../core/supabase.js";
import { InlineKeyboard } from "grammy";
import type { ClanId, WorldRegion, WorldSpot, WorldEdge } from "../../core/types.js";

// کمکی‌ها
const CLAN_LABELS: Record<ClanId, string> = {
  walker: "⚡ Walker",
  stellarieth: "🪽 Stellarieth",
  necroshade: "🖤 Necroshade",
  torrentress: "🔥 Torrentress",
};

function requirePrivate(ctx: EclisContext): boolean {
  if (ctx.chat?.type !== "private") {
    ctx.reply("این مرحله باید در پی‌وی من انجام شود.");
    return false;
  }
  return true;
}

function parseDurationToSeconds(input: string): number | null {
  const txt = input.trim().toLowerCase();
  const match = txt.match(/^(\d+)\s*([sm]?)$/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  if (!match[2] || match[2] === "s") return n;
  if (match[2] === "m") return n * 60;
  return null;
}

// -------------- /aw در گروه --------------

// /aw در گروه → پاک کردن پیام + باز کردن پنل در PV
export async function handleWorldAdminCommand(ctx: EclisContext) {
  if (!isOwner(ctx)) return rejectNonOwner(ctx);

  if (!ctx.chat || ctx.chat.type === "private") {
    return ctx.reply("دستور /aw باید داخل گروهی که می‌خواهی مدیریت کنی ارسال شود.");
  }

  const chat = ctx.chat;

  // پاک کردن پیام دستور در گروه
  try {
    if (ctx.msg) {
      await ctx.api.deleteMessage(chat.id, ctx.msg.message_id);
    }
  } catch {
    // مهم نیست
  }

  // پیدا کردن ریجن مربوط به این گروه
  const chatIdStr = String(chat.id);
  const { data: region, error } = await supabase
    .from("world_regions")
    .select("*")
    .eq("chat_id", chatIdStr)
    .maybeSingle();

  if (error) {
    console.error("Error loading region:", error);
  }

  ctx.session.worldBuilderRegionChatId = chatIdStr;
  ctx.session.worldBuilderRegionTitle = chat.title ?? `Region ${chatIdStr}`;
  ctx.session.worldBuilderRegionId = region ? region.id : null;

const clan = region.clan as ClanId;

await ctx.api.sendMessage(
  ctx.from!.id,
  `🌐 پنل مدیریت جهان برای گروه:\n«${ctx.session.worldBuilderRegionTitle}»\n\n` +
    (region
      ? `ریجن ثبت‌شده است (${CLAN_LABELS[clan]}).`
      : "هنوز به‌عنوان ریجن ثبت نشده."),
  {
    reply_markup: mainAdminKeyboard(),
  },
);

}

function mainAdminKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("🏳️ ریجن این گروه", "wa:region:current")
    .row()
    .text("📍 Spot جدید", "wa:spot:new")
    .text("🔗 Edge جدید", "wa:edge:new")
    .row()
    .text("🗑 حذف", "wa:delete")
    .row()
    .text("📜 لیست مناطق", "wa:regions:list");
  return kb;
}

// -------------- callbackهای wa: --------------

export async function handleWorldAdminCallback(ctx: EclisContext) {
  if (!isOwner(ctx)) return rejectNonOwner(ctx);
  if (!ctx.callbackQuery) return;

  const data = ctx.callbackQuery.data ?? "";
  await ctx.answerCallbackQuery().catch(() => undefined);

  // ریجن این گروه
  if (data === "wa:region:current") {
    return handleRegionCurrent(ctx);
  }

  if (data.startsWith("wa:region:setclan:")) {
    const clan = data.split(":")[3] as ClanId;
    return handleRegionSetClan(ctx, clan);
  }

  // Spot
  if (data === "wa:spot:new") {
    return startCreateSpot(ctx);
  }

  // Edge
  if (data === "wa:edge:new") {
    return startCreateEdge(ctx);
  }

  if (data.startsWith("wa:edge:from:")) {
    const spotId = data.split(":")[3];
    return pickEdgeFrom(ctx, spotId);
  }

  if (data.startsWith("wa:edge:to:")) {
    const spotId = data.split(":")[3];
    return pickEdgeTo(ctx, spotId);
  }

  // حذف
  if (data === "wa:delete") {
    return showDeleteMenu(ctx);
  }

  if (data === "wa:delete:spot") {
    return showDeleteSpotList(ctx);
  }

  if (data === "wa:delete:edge") {
    return showDeleteEdgeList(ctx);
  }

  if (data.startsWith("wa:delete:spot:")) {
    const id = data.split(":")[3];
    return deleteSpotById(ctx, id);
  }

  if (data.startsWith("wa:delete:edge:")) {
    const id = data.split(":")[3];
    return deleteEdgeById(ctx, id);
  }

  // لیست مناطق
  if (data === "wa:regions:list") {
    return showRegionClans(ctx);
  }

  if (data.startsWith("wa:regions:clan:")) {
    const clan = data.split(":")[3] as ClanId;
    return listRegionsByClan(ctx, clan);
  }

  if (data.startsWith("wa:regions:setctx:")) {
    const regionId = data.split(":")[3];
    return setRegionContext(ctx, regionId);
  }
}

// -------------- REGION --------------

async function handleRegionCurrent(ctx: EclisContext) {
  if (!requirePrivate(ctx)) return;

  if (!ctx.session.worldBuilderRegionChatId) {
    return ctx.reply(
      "ریجن فعلی مشخص نیست. دوباره در گروه موردنظر /aw بزن تا کانتکست تنظیم شود.",
    );
  }

  const kb = new InlineKeyboard()
    .text(CLAN_LABELS.walker, "wa:region:setclan:walker")
    .row()
    .text(CLAN_LABELS.stellarieth, "wa:region:setclan:stellarieth")
    .row()
    .text(CLAN_LABELS.necroshade, "wa:region:setclan:necroshade")
    .row()
    .text(CLAN_LABELS.torrentress, "wa:region:setclan:torrentress");

  await ctx.reply(
    "این گروه را زیر کدام خاندان ثبت می‌کنی؟",
    { reply_markup: kb },
  );
}

async function handleRegionSetClan(ctx: EclisContext, clan: ClanId) {
  if (!requirePrivate(ctx)) return;
  const chatId = ctx.session.worldBuilderRegionChatId;
  const title = ctx.session.worldBuilderRegionTitle ?? "Unnamed Region";

  if (!chatId) {
    return ctx.reply(
      "اطلاعات گروه در سشن پیدا نشد. دوباره در گروه /aw بزن.",
    );
  }

  const { data: existing, error: loadErr } = await supabase
    .from("world_regions")
    .select("*")
    .eq("chat_id", chatId)
    .maybeSingle();

  if (loadErr) {
    console.error(loadErr);
  }

  if (existing) {
    const { data, error } = await supabase
      .from("world_regions")
      .update({
        clan,
        name: title,
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error || !data) {
      console.error(error);
      return ctx.reply("در به‌روزرسانی ریجن خطایی رخ داد.");
    }

    ctx.session.worldBuilderRegionId = data.id;
    await ctx.reply(
      `✅ ریجن این گروه به‌روزرسانی شد:\n«${data.name}»\n${CLAN_LABELS[data.clan]}`,
      { reply_markup: mainAdminKeyboard() },
    );
  } else {
    const { data, error } = await supabase
      .from("world_regions")
      .insert({
        clan,
        name: title,
        chat_id: chatId,
      })
      .select()
      .single();

    if (error || !data) {
      console.error(error);
      return ctx.reply("در ثبت ریجن خطایی رخ داد.");
    }

    ctx.session.worldBuilderRegionId = data.id;
    await ctx.reply(
      `✅ ریجن جدید ثبت شد:\n«${data.name}»\n${CLAN_LABELS[data.clan]}`,
      { reply_markup: mainAdminKeyboard() },
    );
  }
}

// -------------- SPOT --------------

async function startCreateSpot(ctx: EclisContext) {
  if (!requirePrivate(ctx)) return;
  const regionId = ctx.session.worldBuilderRegionId;
  if (!regionId) {
    return ctx.reply(
      "هنوز ریجن این گروه مشخص نیست.\nیا در گروه /aw بزن و ریجن را ثبت کن، یا از «📜 لیست مناطق» ریجن دیگری را انتخاب کن.",
    );
  }

  ctx.session.worldBuilderMode = "create_spot_name";
  ctx.session.worldBuilderPayload = { regionId };
  await ctx.reply("نام Spot جدید را بنویس (مثلاً: ورودی شهر، بازار مرکزی، دروازه شمالی و...)");
}

async function actuallyCreateSpot(ctx: EclisContext, title: string) {
  const payload = ctx.session.worldBuilderPayload || {};
  const regionId = payload.regionId as string | undefined;
  if (!regionId) {
    ctx.session.worldBuilderMode = "idle";
    ctx.session.worldBuilderPayload = null;
    return ctx.reply("ریجن نامشخص است. از اول تلاش کن.");
  }

  // پیدا کردن ریجن تا chat_id آن را برای Spot هم استفاده کنیم
  const { data: region, error } = await supabase
    .from("world_regions")
    .select("*")
    .eq("id", regionId)
    .single();

  if (error || !region) {
    console.error(error);
    return ctx.reply("در یافتن ریجن خطایی رخ داد.");
  }

  const { data: spot, error: spotErr } = await supabase
    .from("world_spots")
    .insert({
      title,
      region_id: regionId,
      chat_id: region.chat_id, // فعلاً هر Spot در همین گروه
    })
    .select()
    .single();

  ctx.session.worldBuilderMode = "idle";
  ctx.session.worldBuilderPayload = null;

  if (spotErr || !spot) {
    console.error(spotErr);
    return ctx.reply("در ساخت Spot مشکل پیش آمد.");
  }

  await ctx.reply(
    `📍 Spot جدید ثبت شد:\n«${spot.title}»\nدر ریجن «${region.name}».`,
    { reply_markup: mainAdminKeyboard() },
  );
}

// -------------- EDGE --------------

async function startCreateEdge(ctx: EclisContext) {
  if (!requirePrivate(ctx)) return;
  const regionId = ctx.session.worldBuilderRegionId;
  if (!regionId) {
    return ctx.reply(
      "ریجن انتخاب نشده.\nیا در گروه /aw بزن و ریجن را ثبت کن، یا از «📜 لیست مناطق» استفاده کن.",
    );
  }

  const { data: spots, error } = await supabase
    .from("world_spots")
    .select("*")
    .eq("region_id", regionId)
    .order("title", { ascending: true });

  if (error || !spots || !spots.length) {
    console.error(error);
    return ctx.reply(
      "برای این ریجن هیچ Spotی ثبت نشده.\nاول چند Spot بساز، بعد Edge ایجاد کن.",
    );
  }

  const kb = new InlineKeyboard();
  for (const s of spots as WorldSpot[]) {
    kb.text(`↩ از «${s.title}»`, `wa:edge:from:${s.id}`).row();
  }

  ctx.session.worldBuilderMode = "idle";
  ctx.session.worldBuilderPayload = { regionId };

  await ctx.reply("ابتدا Spot مبدأ را انتخاب کن:", { reply_markup: kb });
}

async function pickEdgeFrom(ctx: EclisContext, fromSpotId: string) {
  if (!requirePrivate(ctx)) return;
  const payload = ctx.session.worldBuilderPayload || {};
  const regionId = payload.regionId as string | undefined;
  if (!regionId) {
    return ctx.reply("ریجن مشخص نیست. دوباره /aw و سپس Edge جدید را بزن.");
  }

  const { data: spots, error } = await supabase
    .from("world_spots")
    .select("*")
    .order("title", { ascending: true });

  if (error || !spots || !spots.length) {
    console.error(error);
    return ctx.reply("هیچ Spotی یافت نشد.");
  }

  const kb = new InlineKeyboard();
  for (const s of spots as WorldSpot[]) {
    kb.text(`⇢ به «${s.title}»`, `wa:edge:to:${s.id}`).row();
  }

  ctx.session.worldBuilderPayload = { regionId, fromSpotId };
  await ctx.reply("حالا Spot مقصد را انتخاب کن:", { reply_markup: kb });
}

async function pickEdgeTo(ctx: EclisContext, toSpotId: string) {
  if (!requirePrivate(ctx)) return;
  const payload = ctx.session.worldBuilderPayload || {};
  const regionId = payload.regionId as string | undefined;
  const fromSpotId = payload.fromSpotId as string | undefined;

  if (!regionId || !fromSpotId) {
    return ctx.reply("اطلاعات Edge ناقص است. دوباره Edge جدید را شروع کن.");
  }

  ctx.session.worldBuilderMode = "create_edge_time";
  ctx.session.worldBuilderPayload = { regionId, fromSpotId, toSpotId };

  await ctx.reply(
    "مدت پایه‌ی سفر را بنویس.\nمثال‌ها: `60` (۶۰ ثانیه)، `2m` (دو دقیقه).",
    { parse_mode: "Markdown" },
  );
}

async function actuallyCreateEdge(ctx: EclisContext, durationInput: string) {
  const payload = ctx.session.worldBuilderPayload || {};
  const regionId = payload.regionId as string | undefined;
  const fromSpotId = payload.fromSpotId as string | undefined;
  const toSpotId = payload.toSpotId as string | undefined;

  ctx.session.worldBuilderMode = "idle";
  ctx.session.worldBuilderPayload = null;

  if (!regionId || !fromSpotId || !toSpotId) {
    return ctx.reply("اطلاعات Edge کامل نیست. دوباره Edge جدید را بساز.");
  }

  const seconds = parseDurationToSeconds(durationInput);
  if (!seconds || seconds <= 0) {
    return ctx.reply("فرمت زمان اشتباه است. فقط عدد، یا عدد+`s` یا عدد+`m`.");
  }

  const { data: fromSpot } = await supabase
    .from("world_spots")
    .select("*")
    .eq("id", fromSpotId)
    .single();

  const { data: toSpot } = await supabase
    .from("world_spots")
    .select("*")
    .eq("id", toSpotId)
    .single();

  const { data: edge, error } = await supabase
    .from("world_edges")
    .insert({
      from_spot_id: fromSpotId,
      to_spot_id: toSpotId,
      base_travel_seconds: seconds,
      can_walk: true, // فعلاً فقط پیاده؛ بعداً برای سوارکار/راننده/حمل‌ونقل هم UI می‌چسبونیم
      can_ride: false,
      can_drive: false,
      can_transport: false,
    })
    .select()
    .single();

  if (error || !edge) {
    console.error(error);
    return ctx.reply("در ساخت Edge مشکل پیش آمد.");
  }

  await ctx.reply(
    `🔗 Edge جدید ثبت شد:\n` +
      `از «${fromSpot?.title ?? fromSpotId}»\n` +
      `به «${toSpot?.title ?? toSpotId}»\n` +
      `زمان پایه: ${seconds} ثانیه`,
    { reply_markup: mainAdminKeyboard() },
  );
}

// -------------- DELETE --------------

async function showDeleteMenu(ctx: EclisContext) {
  if (!requirePrivate(ctx)) return;
  const kb = new InlineKeyboard()
    .text("🗑 حذف Spot", "wa:delete:spot")
    .row()
    .text("🗑 حذف Edge", "wa:delete:edge");
  await ctx.reply("چه چیزی را می‌خواهی حذف کنی؟", { reply_markup: kb });
}

async function showDeleteSpotList(ctx: EclisContext) {
  if (!requirePrivate(ctx)) return;
  const regionId = ctx.session.worldBuilderRegionId;
  if (!regionId) {
    return ctx.reply(
      "ریجن انتخاب نشده است. از «📜 لیست مناطق» یکی را انتخاب کن یا در گروه /aw بزن.",
    );
  }

  const { data: spots, error } = await supabase
    .from("world_spots")
    .select("*")
    .eq("region_id", regionId)
    .order("title", { ascending: true });

  if (error || !spots || !spots.length) {
    console.error(error);
    return ctx.reply("Spotای برای این ریجن یافت نشد.");
  }

  const kb = new InlineKeyboard();
  for (const s of spots as WorldSpot[]) {
    kb.text(`حذف «${s.title}»`, `wa:delete:spot:${s.id}`).row();
  }

  await ctx.reply("یک Spot برای حذف انتخاب کن:", { reply_markup: kb });
}

async function deleteSpotById(ctx: EclisContext, spotId: string) {
  if (!requirePrivate(ctx)) return;

  // اول Edgeهایی که به این Spot وصل‌اند حذف شوند
  const { error: edgeErr } = await supabase
    .from("world_edges")
    .delete()
    .or(`from_spot_id.eq.${spotId},to_spot_id.eq.${spotId}`);

  if (edgeErr) {
    console.error(edgeErr);
  }

  const { error } = await supabase
    .from("world_spots")
    .delete()
    .eq("id", spotId);

  if (error) {
    console.error(error);
    return ctx.reply("در حذف Spot مشکل پیش آمد.");
  }

  await ctx.reply("Spot و تمام Edgeهای مرتبط با آن حذف شدند.");
}

async function showDeleteEdgeList(ctx: EclisContext) {
  if (!requirePrivate(ctx)) return;
  const regionId = ctx.session.worldBuilderRegionId;
  if (!regionId) {
    return ctx.reply(
      "ریجن انتخاب نشده است. از «📜 لیست مناطق» یکی را انتخاب کن یا در گروه /aw بزن.",
    );
  }

  // اول Spotهای این ریجن را بگیریم
  const { data: spots, error: spotErr } = await supabase
    .from("world_spots")
    .select("*")
    .eq("region_id", regionId);

  if (spotErr || !spots || !spots.length) {
    console.error(spotErr);
    return ctx.reply("Spotای برای این ریجن یافت نشد.");
  }

  const spotIds = (spots as WorldSpot[]).map((s) => s.id);

  const { data: edges, error: edgeErr } = await supabase
    .from("world_edges")
    .select("*")
    .in("from_spot_id", spotIds);

  if (edgeErr || !edges || !edges.length) {
    console.error(edgeErr);
    return ctx.reply("هیچ Edgeای برای این ریجن ثبت نشده.");
  }

  const kb = new InlineKeyboard();

  for (const e of edges as WorldEdge[]) {
    const from = (spots as WorldSpot[]).find((s) => s.id === e.from_spot_id);
    const to = (spots as WorldSpot[]).find((s) => s.id === e.to_spot_id);
    const label = `«${from?.title ?? "?"}» ⇢ «${to?.title ?? "?"}»`;

    kb.text(label, `wa:delete:edge:${e.id}`).row();
  }

  await ctx.reply("یک Edge برای حذف انتخاب کن:", { reply_markup: kb });
}

async function deleteEdgeById(ctx: EclisContext, edgeId: string) {
  if (!requirePrivate(ctx)) return;

  const { error } = await supabase
    .from("world_edges")
    .delete()
    .eq("id", edgeId);

  if (error) {
    console.error(error);
    return ctx.reply("در حذف Edge مشکل پیش آمد.");
  }

  await ctx.reply("Edge حذف شد.");
}

// -------------- لیست مناطق بر اساس خاندان --------------

async function showRegionClans(ctx: EclisContext) {
  if (!requirePrivate(ctx)) return;
  const kb = new InlineKeyboard()
    .text(CLAN_LABELS.walker, "wa:regions:clan:walker")
    .row()
    .text(CLAN_LABELS.stellarieth, "wa:regions:clan:stellarieth")
    .row()
    .text(CLAN_LABELS.necroshade, "wa:regions:clan:necroshade")
    .row()
    .text(CLAN_LABELS.torrentress, "wa:regions:clan:torrentress");

  await ctx.reply("خاندان موردنظر را انتخاب کن:", { reply_markup: kb });
}

async function listRegionsByClan(ctx: EclisContext, clan: ClanId) {
  if (!requirePrivate(ctx)) return;

  const { data: regions, error } = await supabase
    .from("world_regions")
    .select("*")
    .eq("clan", clan)
    .order("name", { ascending: true });

  if (error || !regions || !regions.length) {
    console.error(error);
    return ctx.reply("برای این خاندان هیچ ریجنی ثبت نشده.");
  }

  const kb = new InlineKeyboard();

  for (const r of regions as WorldRegion[]) {
    kb.text(`«${r.name}»`, `wa:regions:setctx:${r.id}`).row();
  }

  await ctx.reply("یک ریجن را برای مدیریت انتخاب کن:", { reply_markup: kb });
}

async function setRegionContext(ctx: EclisContext, regionId: string) {
  if (!requirePrivate(ctx)) return;

  const { data: region, error } = await supabase
    .from("world_regions")
    .select("*")
    .eq("id", regionId)
    .single();

  if (error || !region) {
    console.error(error);
    return ctx.reply("در یافتن ریجن مشکل پیش آمد.");
  }

  ctx.session.worldBuilderRegionId = region.id;
  ctx.session.worldBuilderRegionChatId = region.chat_id;
  ctx.session.worldBuilderRegionTitle = region.name;

  await ctx.reply(
    `✅ ریجن فعال تنظیم شد:\n«${region.name}»\n${CLAN_LABELS[region.clan]}`,
    { reply_markup: mainAdminKeyboard() },
  );
}

// -------------- هندل تکست برای ویزاردها --------------

export async function handleWorldAdminText(ctx: EclisContext) {
  if (ctx.chat?.type !== "private") return;
  const mode = ctx.session.worldBuilderMode;

  if (mode === "create_spot_name") {
    const name = ctx.message?.text?.trim();
    if (!name) return;
    await actuallyCreateSpot(ctx, name);
    return;
  }

  if (mode === "create_edge_time") {
    const txt = ctx.message?.text?.trim();
    if (!txt) return;
    await actuallyCreateEdge(ctx, txt);
    return;
  }

  // در غیر این حالت‌ها، به منوی اصلی یا هندلرهای دیگر اجازه بده کار خودشان را کنند
}
