import type { EclisContext } from "../../core/bot.js";
import { supabase } from "../../core/supabase.js";
import type { MovementMode, WorldEdge, WorldSpot } from "../../core/types.js";
import { InlineKeyboard } from "grammy";

interface CharacterRow {
  id: string;
  telegram_id: number;
  region_id: string;
  spot_id: string;
}

interface CharacterTravelRow {
  id: string;
  telegram_id: number;
  from_spot_id: string;
  to_spot_id: string;
  mode: MovementMode;
  started_at: string;
  arrive_at: string;
  canceled: boolean;
  finished: boolean;
  base_travel_seconds: number;
}

function getModeColumn(mode: MovementMode): keyof WorldEdge {
  if (mode === "ride") return "can_ride";
  if (mode === "drive") return "can_drive";
  if (mode === "transport") return "can_transport";
  return "can_walk";
}

function getModeMultiplier(mode: MovementMode): number {
  // سرعت‌ها:
  // walk = 1x  (کندتر ولی همیشه در دسترس)
  // ride = 0.7x
  // drive = 0.4x
  // transport = 0.25x (خیلی سریع ولی خاص)
  if (mode === "ride") return 0.7;
  if (mode === "drive") return 0.4;
  if (mode === "transport") return 0.25;
  return 1;
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins <= 1) return "کمتر از ۱ دقیقه";
  return `${mins} دقیقه`;
}

async function getCharacter(
  telegramId: number,
): Promise<CharacterRow | null> {
  const { data, error } = await supabase
    .from("characters")
    .select("id, telegram_id, region_id, spot_id")
    .eq("telegram_id", telegramId)
    .single();

  if (error || !data) return null;
  return data as CharacterRow;
}

async function getSpot(spotId: string): Promise<WorldSpot | null> {
  const { data, error } = await supabase
    .from("world_spots")
    .select("*")
    .eq("id", spotId)
    .single();

  if (error || !data) return null;
  return data as WorldSpot;
}

async function getEdgesForSpotAndMode(
  spotId: string,
  mode: MovementMode,
): Promise<WorldEdge[]> {
  const column = getModeColumn(mode);

  const { data, error } = await supabase
    .from("world_edges")
    .select("*")
    .eq("from_spot_id", spotId)
    .eq(column, true);

  if (error || !data) return [];
  return data as WorldEdge[];
}

async function getActiveTravel(
  telegramId: number,
): Promise<CharacterTravelRow | null> {
  const { data, error } = await supabase
    .from("character_travels")
    .select("*")
    .eq("telegram_id", telegramId)
    .eq("canceled", false)
    .eq("finished", false)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as CharacterTravelRow;
}

// تکمیل خودکار سفر اگر زمانش گذشته
export async function completeTravelIfNeeded(ctx: EclisContext) {
  if (!ctx.from) return;
  const active = await getActiveTravel(ctx.from.id);
  if (!active) return;

  const now = new Date();
  const arriveAt = new Date(active.arrive_at);
  if (arriveAt.getTime() > now.getTime()) {
    // هنوز نرسیده
    return;
  }

  // سفر تمام شده → شخصیت را به Spot مقصد منتقل کن
  const { error: updTravelError } = await supabase
    .from("character_travels")
    .update({ finished: true })
    .eq("id", active.id);

  if (updTravelError) {
    console.error("Error finishing travel:", updTravelError);
  }

  // آپدیت لوکیشن کاراکتر
  const destSpot = await getSpot(active.to_spot_id);
  const fromSpot = await getSpot(active.from_spot_id);

  if (destSpot) {
    const { error: updCharError } = await supabase
      .from("characters")
      .update({
        spot_id: destSpot.id,
        region_id: destSpot.region_id,
      })
      .eq("telegram_id", ctx.from.id);

    if (updCharError) {
      console.error("Error updating character location:", updCharError);
    }
  }

  // کیک از گروه مبدا
  if (fromSpot?.chat_id) {
    try {
      const chatId = Number(fromSpot.chat_id);
      await ctx.api.banChatMember(chatId, ctx.from.id);
      await ctx.api.unbanChatMember(chatId, ctx.from.id);
    } catch (err) {
      console.error("Error kicking from source chat:", err);
    }
  }

  // لینک گروه مقصد
  let inviteLink: string | null = null;
  if (destSpot?.chat_id) {
    try {
      const destChatId = Number(destSpot.chat_id);
      inviteLink = await ctx.api.exportChatInviteLink(destChatId);
    } catch (err) {
      console.error("Error exporting invite link:", err);
    }
  }

  let text = `سفرت از «${fromSpot?.title ?? "?"}» به «${
    destSpot?.title ?? "?"
  }» به پایان رسید.`;

  if (inviteLink) {
    text += `\n\nبرای ورود به گروه مقصد از این لینک استفاده کن:\n${inviteLink}`;
  } else {
    text +=
      "\n\nربات نتوانست لینک مقصد را بسازد؛ ارباب باید تو را دستی وارد گروه کند.";
  }

  // پاک کردن وضعیت سفر از سشن
  ctx.session.travelEdgeId = null;
  ctx.session.travelStartAt = null;
  ctx.session.travelEta = null;

  await ctx.api.sendMessage(ctx.from.id, text);
}

// نمایش «مسیرهای من» + شروع سفر
export async function handleMyPaths(ctx: EclisContext) {
  if (!ctx.from) return;

  // اول ببین آیا سفری تمام نشده که باید تکمیل بشه یا نه
  await completeTravelIfNeeded(ctx);

  const character = await getCharacter(ctx.from.id);
  if (!character) {
    return ctx.reply(
      "هنوز برای شخصیتت موقعیت ثبت نشده.\nارباب باید تو را در یک Spot اولیه قرار بدهد.",
    );
  }

  const active = await getActiveTravel(ctx.from.id);
  if (active) {
    // در حال سفر
    const now = new Date();
    const arriveAt = new Date(active.arrive_at);
    const remainingSeconds = Math.max(
      0,
      Math.round((arriveAt.getTime() - now.getTime()) / 1000),
    );

    const fromSpot = await getSpot(active.from_spot_id);
    const toSpot = await getSpot(active.to_spot_id);

    const kb = new InlineKeyboard();
    if (active.mode !== "transport") {
      kb.text("⏹ لغو سفر", `travel:cancel:${active.id}`).row();
    }
    kb.text("🔄 بروزرسانی", "travel:refresh");

    let text = `در حال سفر هستی:\n\nاز «${fromSpot?.title ?? "?"}» به «${
      toSpot?.title ?? "?"
    }»\nحالت: ${active.mode}\nزمان باقی‌مانده: ${formatDuration(
      remainingSeconds,
    )}`;

    if (active.mode === "transport") {
      text += "\n\nاین سفر با سیستم حمل‌ونقل است و قابل لغو نیست.";
    }

    return ctx.reply(text, { reply_markup: kb });
  }

  // اگر سفر فعالی نیست → مسیرهای در دسترس
  const mode: MovementMode = ctx.session.movementMode ?? "walk";
  const edges = await getEdgesForSpotAndMode(character.spot_id, mode);
  const spot = await getSpot(character.spot_id);
  const placeTitle = spot ? spot.title : "مکان ناشناس";

  if (!edges.length) {
    return ctx.reply(
      `مکان فعلی:\n${placeTitle}\n\nبرای حالت فعلی (${mode}) هیچ مسیری ثبت نشده.`,
    );
  }

  const kb = new InlineKeyboard();
  let text = `مکان فعلی:\n${placeTitle}\n\nمسیرهای در دسترس (حالت: ${mode}):\n`;

  for (const e of edges) {
    const toSpot = await getSpot(e.to_spot_id);
    const name = toSpot ? toSpot.title : e.to_spot_id;
    const multiplier = getModeMultiplier(mode);
    const effectiveSeconds = Math.max(
      5,
      Math.round(e.base_travel_seconds * multiplier),
    );
    const label = `به «${name}» — ${formatDuration(effectiveSeconds)}`;

    text += `\n• ${label}`;
    kb.text(label, `travel:go:${e.id}`).row();
  }

  await ctx.reply(text, { reply_markup: kb });
}

// هندلر callback سفرها
export async function handleTravelCallback(ctx: EclisContext) {
  if (!ctx.from) return;
  const data = ctx.callbackQuery?.data ?? "";

  if (data === "travel:refresh") {
    await ctx.answerCallbackQuery();
    // فقط خروجی handleMyPaths آپدیت بشه
    return handleMyPaths(ctx);
  }

  if (data.startsWith("travel:go:")) {
    await ctx.answerCallbackQuery();
    const edgeId = data.split(":")[2];
    return startTravel(ctx, edgeId);
  }

  if (data.startsWith("travel:cancel:")) {
    await ctx.answerCallbackQuery();
    const travelId = data.split(":")[2];
    return cancelTravel(ctx, travelId);
  }
}

async function startTravel(ctx: EclisContext, edgeId: string) {
  const character = await getCharacter(ctx.from!.id);
  if (!character) {
    return ctx.reply(
      "شخصیتت لوکیشن ثبت‌شده ندارد؛ ارباب باید تو را به یک Spot منتقل کند.",
    );
  }

  const active = await getActiveTravel(ctx.from!.id);
  if (active) {
    return ctx.reply(
      "در حال حاضر در وسط یک سفر هستی؛ اول آن را تمام کن یا (اگر مجاز است) لغوش کن.",
    );
  }

  const { data: edge, error } = await supabase
    .from("world_edges")
    .select("*")
    .eq("id", edgeId)
    .single();

  if (error || !edge) {
    console.error("Edge not found:", error);
    return ctx.reply("این مسیر دیگر در دسترس نیست.");
  }

  const e = edge as WorldEdge;

  if (e.from_spot_id !== character.spot_id) {
    return ctx.reply(
      "این مسیر از مکان فعلی‌ات شروع نمی‌شود. دوباره «مسیرهای من» را باز کن.",
    );
  }

  const mode: MovementMode = ctx.session.movementMode ?? "walk";
  const col = getModeColumn(mode);
  if (!(e as any)[col]) {
    return ctx.reply("این مسیر برای حالت حرکتی فعلی‌ات مجاز نیست.");
  }

  const multiplier = getModeMultiplier(mode);
  const effectiveSeconds = Math.max(
    5,
    Math.round(e.base_travel_seconds * multiplier),
  );

  const now = new Date();
  const arriveAt = new Date(now.getTime() + effectiveSeconds * 1000);

  const { error: insertError, data } = await supabase
    .from("character_travels")
    .insert({
      telegram_id: ctx.from!.id,
      from_spot_id: character.spot_id,
      to_spot_id: e.to_spot_id,
      mode,
      started_at: now.toISOString(),
      arrive_at: arriveAt.toISOString(),
      base_travel_seconds: effectiveSeconds,
    })
    .select()
    .single();

  if (insertError || !data) {
    console.error("Error inserting travel:", insertError);
    return ctx.reply("در شروع سفر مشکلی پیش آمد.");
  }

  ctx.session.travelEdgeId = e.id;
  ctx.session.travelStartAt = Math.floor(now.getTime() / 1000);
  ctx.session.travelEta = Math.floor(arriveAt.getTime() / 1000);

  const toSpot = await getSpot(e.to_spot_id);
  const fromSpot = await getSpot(e.from_spot_id);

  const text = `سفر تو از «${fromSpot?.title ?? "?"}» به «${
    toSpot?.title ?? "?"
  }» آغاز شد.\n\nزمان تقریبی: ${formatDuration(
    effectiveSeconds,
  )}\nحالت حرکت: ${mode}`;

  await ctx.reply(text);
}

async function cancelTravel(ctx: EclisContext, travelId: string) {
  const active = await getActiveTravel(ctx.from!.id);
  if (!active || active.id !== travelId) {
    return ctx.reply("هیچ سفر فعالی برای لغو پیدا نشد.");
  }

  if (active.mode === "transport") {
    return ctx.reply(
      "این سفر با سیستم حمل‌ونقل است و طبق قوانین قابل لغو نیست.",
    );
  }

  const { error } = await supabase
    .from("character_travels")
    .update({ canceled: true })
    .eq("id", active.id);

  if (error) {
    console.error("Error canceling travel:", error);
    return ctx.reply("در لغو سفر مشکلی پیش آمد.");
  }

  ctx.session.travelEdgeId = null;
  ctx.session.travelStartAt = null;
  ctx.session.travelEta = null;

  const fromSpot = await getSpot(active.from_spot_id);
  await ctx.reply(
    `سفر لغو شد.\nهنوز در «${fromSpot?.title ?? "?"}» هستی.`,
  );
}
