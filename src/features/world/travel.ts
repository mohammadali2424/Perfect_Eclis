import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { supabase } from "../../core/supabase";

// نوع مود حرکت کاراکتر
type MovementMode = "walk" | "ride" | "drive" | "transport";

interface CharacterRow {
  id: number;
  tg_id: number;
  current_region_id: string | null; // uuid
  current_spot_id: string | null;   // uuid
  movement_mode: MovementMode;
  travel_state: "idle" | "in_travel" | null;
  travel_started_at: string | null;
  travel_duration_seconds: number | null;
  travel_from_spot_id: string | null; // uuid
  travel_to_spot_id: string | null;   // uuid
}

interface SpotRow {
  id: string; // uuid
  name: string;
  region_id: string;
}

interface RegionRow {
  id: string; // uuid
  name: string;
}

interface EdgeRow {
  id: number;
  from_spot_id: string;
  to_spot_id: string;
  name: string | null;
  base_seconds: number;
  ride_seconds: number | null;
  drive_seconds: number | null;
  can_walk: boolean;
  can_ride: boolean;
  can_drive: boolean;
}

interface TransportLineRow {
  id: string;
  name: string;
  from_spot_id: string;
  to_spot_id: string;
  travel_seconds: number;
  cost_solen: number;
}

// حداقل زمان سفر وقتی از مسیر قبلی “کردیت” می‌گیریم
const MIN_TRAVEL_SECONDS = 20;

/**
 * گرفتن کاراکتر از روی tg_id
 */
async function getCharacter(ctx: MyContext): Promise<CharacterRow | null> {
  if (!ctx.from) return null;

  const { data, error } = await supabase
    .from("characters")
    .select(
      `
      id,
      tg_id,
      current_region_id,
      current_spot_id,
      movement_mode,
      travel_state,
      travel_started_at,
      travel_duration_seconds,
      travel_from_spot_id,
      travel_to_spot_id
    `
    )
    .eq("tg_id", ctx.from.id)
    .maybeSingle();

  if (error) {
    console.error("getCharacter error", error);
    return null;
  }
  return data as CharacterRow | null;
}

/**
 * آپدیت وضعیت کاراکتر
 */
async function updateCharacter(
  id: number,
  patch: Partial<CharacterRow>
): Promise<boolean> {
  const { error } = await supabase
    .from("characters")
    .update(patch)
    .eq("id", id);

  if (error) {
    console.error("updateCharacter error", error);
    return false;
  }
  return true;
}

/**
 * گرفتن spot + region برای نمایش نقشه سریع
 */
async function getSpotAndRegion(
  spotId: string | null
): Promise<{ spot: SpotRow | null; region: RegionRow | null }> {
  if (!spotId) return { spot: null, region: null };

  const { data: spot, error: spotErr } = await supabase
    .from("spots")
    .select("id, name, region_id")
    .eq("id", spotId)
    .maybeSingle();

  if (spotErr || !spot) {
    console.error("getSpotAndRegion spot error", spotErr);
    return { spot: null, region: null };
  }

  const s = spot as SpotRow;

  const { data: region, error: regErr } = await supabase
    .from("regions")
    .select("id, name")
    .eq("id", s.region_id)
    .maybeSingle();

  if (regErr || !region) {
    if (regErr) console.error("getSpotAndRegion region error", regErr);
    return { spot: s, region: null };
  }

  return {
    spot: s,
    region: region as RegionRow,
  };
}

/**
 * گرفتن edgeهای قابل دسترس از spot فعلی
 * بر اساس movement_mode
 */
async function getAvailableEdges(
  currentSpotId: string,
  mode: MovementMode
): Promise<EdgeRow[]> {
  const { data, error } = await supabase
    .from("edges")
    .select(
      `
      id,
      from_spot_id,
      to_spot_id,
      name,
      base_seconds,
      ride_seconds,
      drive_seconds,
      can_walk,
      can_ride,
      can_drive
    `
    )
    .eq("from_spot_id", currentSpotId);

  if (error || !data) {
    console.error("getAvailableEdges error", error);
    return [];
  }

  const edges = data as EdgeRow[];

  return edges.filter((e) => {
    if (mode === "walk") return e.can_walk;
    if (mode === "ride") return e.can_ride;
    if (mode === "drive") return e.can_drive;
    // برای transport از edgeها استفاده نمی‌کنیم
    return false;
  });
}

/**
 * محاسبه زمان مؤثر سفر برای edge با توجه به mode
 */
function computeTravelSeconds(edge: EdgeRow, mode: MovementMode): number {
  const base = edge.base_seconds;

  switch (mode) {
    case "walk":
      return base;
    case "ride":
      if (edge.ride_seconds != null) return edge.ride_seconds;
      return Math.max(1, Math.round(base * 0.6));
    case "drive":
      if (edge.drive_seconds != null) return edge.drive_seconds;
      return Math.max(1, Math.round(base * 0.4));
    default:
      return base;
  }
}

/**
 * گرفتن خطوط حمل‌ونقل (قطار/بالن) از spot فعلی
 */
async function getTransportLinesFromSpot(
  spotId: string
): Promise<TransportLineRow[]> {
  const { data, error } = await supabase
    .from("transport_lines")
    .select(
      `
      id,
      name,
      from_spot_id,
      to_spot_id,
      travel_seconds,
      cost_solen
    `
    )
    .eq("from_spot_id", spotId);

  if (error || !data) {
    console.error("getTransportLinesFromSpot error", error);
    return [];
  }

  return data as TransportLineRow[];
}

/**
 * محاسبه اعتبار زمانی هنگام تغییر مسیر
 */
function computeBorrowedDuration(
  previousDuration: number,
  startedAtIso: string
): { elapsed: number; credit: number } {
  const startedAt = new Date(startedAtIso).getTime();
  const now = Date.now();

  if (Number.isNaN(startedAt)) {
    return { elapsed: 0, credit: 0 };
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((now - startedAt) / 1000)
  );

  const clamped = Math.min(elapsedSeconds, previousDuration);

  return {
    elapsed: clamped,
    credit: clamped,
  };
}

/**
 * ساخت متن زمان تقریبی
 */
function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} ثانیه`;
  const minutes = Math.round(sec / 60);
  return `${minutes} دقیقه`;
}

/**
 * هندلر /path و دکمه «مسیر های من»
 */
async function handleShowPaths(ctx: MyContext) {
  const char = await getCharacter(ctx);
  if (!char) {
    await ctx.reply("شما هنوز برای سیستم مسیر اکلیس ثبت نشده‌اید.");
    return;
  }
  if (!char.current_spot_id) {
    await ctx.reply("مکان فعلی شما مشخص نیست. با مدیریت جهان تماس بگیرید.");
    return;
  }

  const mode: MovementMode = char.movement_mode || "walk";

  if (mode === "transport") {
    await ctx.reply(
      "در حال حاضر در یک سفر حمل‌ونقلی (قطار/بالن) هستی.\n" +
        "اول باید سفر فعلی‌ات تمام شود، بعد می‌توانی مسیر جدید انتخاب کنی."
    );
    return;
  }

  const edges = await getAvailableEdges(char.current_spot_id, mode);

  const { spot, region } = await getSpotAndRegion(char.current_spot_id);

  let header = "📍 مسیرهای قابل دسترس از موقعیت فعلی:\n\n";

  if (region && spot) {
    header =
      `📍 موقعیت فعلی:\n` +
      `نژاد/ریجن: ${region.name}\n` +
      `نقطه: ${spot.name}\n\n` +
      `🧭 مسیرهای قابل دسترس:\n\n`;
  }

  if (edges.length === 0) {
    await ctx.reply(
      header + "از این نقطه هیچ مسیری برای حالت حرکت فعلی‌ات تعریف نشده."
    );
    return;
  }

  const kb = new InlineKeyboard();

  edges.forEach((e) => {
    const dur = computeTravelSeconds(e, mode);
    const label =
      (e.name || "مسیر ناشناس") + ` • ${formatDuration(dur)}`;
    kb.text(label, `travel:edge:${e.id}`).row();
  });

  await ctx.reply(header, { reply_markup: kb });
}

/**
 * هندلر دکمه «🗺 نقشه سریع من»
 */
async function handleQuickMap(ctx: MyContext) {
  const char = await getCharacter(ctx);
  if (!char || !char.current_spot_id) {
    await ctx.reply("مکان فعلی شما مشخص نیست یا هنوز ثبت نشده‌اید.");
    return;
  }

  const { spot, region } = await getSpotAndRegion(char.current_spot_id);

  if (!spot || !region) {
    await ctx.reply(
      "اطلاعات نقشه برای موقعیت فعلی‌ات ناقص است. با مدیریت جهان تماس بگیر."
    );
    return;
  }

  const mode = char.movement_mode || "walk";

  const text =
    `🗺 نقشه سریع تو:\n\n` +
    `🏞 ریجن: ${region.name}\n` +
    `📍 نقطه: ${spot.name}\n` +
    `🚶‍♂️ حالت حرکت: ${modeLabel(mode)}\n`;

  await ctx.reply(text);
}

function modeLabel(mode: MovementMode): string {
  switch (mode) {
    case "walk":
      return "پیاده";
    case "ride":
      return "سوارکار (حیوان سواری)";
    case "drive":
      return "راننده (وسیله)";
    case "transport":
      return "حمل‌ونقل (قطار/بالن)";
    default:
      return mode;
  }
}

/**
 * شروع سفر روی یک edge
 * callback_data = travel:edge:<id>
 */
async function handleEdgeTravelCallback(ctx: MyContext) {
  if (!ctx.callbackQuery?.data) return;
  const parts = ctx.callbackQuery.data.split(":");
  if (parts.length !== 3) return;
  const [, kind, idStr] = parts;
  if (kind !== "edge") return;

  const edgeId = Number(idStr);
  if (!Number.isFinite(edgeId)) return;

  const char = await getCharacter(ctx);
  if (!char) {
    await ctx.answerCallbackQuery({
      text: "ابتدا باید برای سیستم مسیر ثبت شده باشی (/regplayer).",
      show_alert: true,
    });
    return;
  }

  if (!char.current_spot_id) {
    await ctx.answerCallbackQuery({
      text: "مکان فعلی شما مشخص نیست.",
      show_alert: true,
    });
    return;
  }

  if (char.movement_mode === "transport") {
    await ctx.answerCallbackQuery({
      text: "در حال حاضر داخل سفر حمل‌ونقلی هستی و نمی‌توانی مسیر را عوض کنی.",
      show_alert: true,
    });
    return;
  }

  const mode: MovementMode = char.movement_mode || "walk";

  const { data: edgeData, error: edgeErr } = await supabase
    .from("edges")
    .select(
      `
      id,
      from_spot_id,
      to_spot_id,
      name,
      base_seconds,
      ride_seconds,
      drive_seconds,
      can_walk,
      can_ride,
      can_drive
    `
    )
    .eq("id", edgeId)
    .maybeSingle();

  if (edgeErr || !edgeData) {
    console.error("edge not found", edgeErr);
    await ctx.answerCallbackQuery({
      text: "این مسیر دیگر در دسترس نیست.",
      show_alert: true,
    });
    return;
  }

  const edge = edgeData as EdgeRow;

  if (mode === "walk" && !edge.can_walk) {
    await ctx.answerCallbackQuery({
      text: "با حالت پیاده نمی‌توانی از این مسیر بروی.",
      show_alert: true,
    });
    return;
  }
  if (mode === "ride" && !edge.can_ride) {
    await ctx.answerCallbackQuery({
      text: "با حالت سوارکار نمی‌توانی از این مسیر بروی.",
      show_alert: true,
    });
    return;
  }
  if (mode === "drive" && !edge.can_drive) {
    await ctx.answerCallbackQuery({
      text: "با وسیله نمی‌توانی از این مسیر بروی.",
      show_alert: true,
    });
    return;
  }

  let duration = computeTravelSeconds(edge, mode);

  if (
    char.travel_state === "in_travel" &&
    char.travel_started_at &&
    char.travel_duration_seconds
  ) {
    const { credit } = computeBorrowedDuration(
      char.travel_duration_seconds,
      char.travel_started_at
    );

    const newDuration = duration - credit;
    duration = Math.max(MIN_TRAVEL_SECONDS, newDuration);

    await ctx.answerCallbackQuery({
      text: `مسیرت را عوض کردی؛ ${formatDuration(
        credit
      )} از مسیر قبلی‌ات کم شد.`,
      show_alert: false,
    });
  } else {
    await ctx.answerCallbackQuery().catch(() => undefined);
  }

  const nowIso = new Date().toISOString();

  const ok = await updateCharacter(char.id, {
    travel_state: "in_travel",
    travel_started_at: nowIso,
    travel_duration_seconds: duration,
    travel_from_spot_id: edge.from_spot_id,
    travel_to_spot_id: edge.to_spot_id,
  });

  if (!ok) {
    await ctx.reply("در شروع سفر مشکلی پیش آمد.");
    return;
  }

  const { spot: toSpot, region: toRegion } = await getSpotAndRegion(
    edge.to_spot_id
  );

  const targetName =
    (toRegion ? toRegion.name + " / " : "") +
    (toSpot ? toSpot.name : "نقطه ناشناس");

  const text =
    `🧭 سفر آغاز شد.\n\n` +
    `🎭 حالت حرکت: ${modeLabel(mode)}\n` +
    `🎯 مقصد: ${targetName}\n` +
    `⏳ زمان تقریبی: ${formatDuration(duration)}\n\n` +
    `وقتی زمانت تمام شد یا فکر کردی رسیدی، دستور /arrive را بزن.`;

  await ctx.reply(text);
}

/**
 * هندلر /arrive
 */
async function handleArrive(ctx: MyContext) {
  const char = await getCharacter(ctx);
  if (!char) {
    await ctx.reply("هنوز برای سیستم مسیر ثبت نشده‌ای.");
    return;
  }

  if (
    char.travel_state !== "in_travel" ||
    !char.travel_started_at ||
    !char.travel_duration_seconds ||
    !char.travel_to_spot_id
  ) {
    await ctx.reply("در حال حاضر در سفری نیستی که بخواهی به مقصد برسی.");
    return;
  }

  const startedAt = new Date(char.travel_started_at).getTime();
  const now = Date.now();
  const elapsed = Math.max(
    0,
    Math.floor((now - startedAt) / 1000)
  );

  if (elapsed < char.travel_duration_seconds) {
    const remaining = char.travel_duration_seconds - elapsed;
    await ctx.reply(
      `هنوز به مقصدت نرسیدی.\nحدود ${formatDuration(
        remaining
      )} دیگر باید در مسیر باشی.`
    );
    return;
  }

  const newSpotId = char.travel_to_spot_id;

  const { spot, region } = await getSpotAndRegion(newSpotId);

  const ok = await updateCharacter(char.id, {
    current_spot_id: newSpotId,
    current_region_id: spot ? spot.region_id : char.current_region_id,
    travel_state: "idle",
    travel_started_at: null,
    travel_duration_seconds: null,
    travel_from_spot_id: null,
    travel_to_spot_id: null,
  });

  if (!ok) {
    await ctx.reply("در ثبت رسیدن به مقصد مشکلی پیش آمد.");
    return;
  }

  const targetName =
    (region ? region.name + " / " : "") +
    (spot ? spot.name : "نقطه ناشناس");

  await ctx.reply(
    `✅ به مقصد رسیدی.\n\nمکان فعلی‌ات اکنون:\n${targetName}`
  );
}

/**
 * هندلر /transport – دیدن خطوط حمل‌ونقل
 */
async function handleTransport(ctx: MyContext) {
  const char = await getCharacter(ctx);
  if (!char || !char.current_spot_id) {
    await ctx.reply(
      "مکان فعلی تو مشخص نیست یا هنوز ثبت نشده‌ای."
    );
    return;
  }

  const lines = await getTransportLinesFromSpot(char.current_spot_id);
  if (lines.length === 0) {
    await ctx.reply(
      "از موقعیت فعلی‌ات هیچ مسیر حمل‌ونقلی (قطار/بالن) در دسترس نیست."
    );
    return;
  }

  const kb = new InlineKeyboard();
  lines.forEach((l) => {
    const label =
      `${l.name} • ${formatDuration(
        l.travel_seconds
      )} • هزینه: ${l.cost_solen} سولن`;
    kb.text(label, `travel:transport:${l.id}`).row();
  });

  await ctx.reply(
    "🚂 مسیرهای حمل‌ونقلی در دسترس از موقعیت فعلی:",
    { reply_markup: kb }
  );
}

/**
 * شروع سفر transport
 * callback_data = travel:transport:<id>
 */
async function handleTransportCallback(ctx: MyContext) {
  if (!ctx.callbackQuery?.data) return;
  const parts = ctx.callbackQuery.data.split(":");
  if (parts.length !== 3) return;
  const [, kind, idStr] = parts;
  if (kind !== "transport") return;

  const lineId = idStr; // uuid string

  const char = await getCharacter(ctx);
  if (!char) {
    await ctx.answerCallbackQuery({
      text: "ابتدا باید در جهان ثبت شده باشی.",
      show_alert: true,
    });
    return;
  }

  if (char.travel_state === "in_travel") {
    await ctx.answerCallbackQuery({
      text: "در حال حاضر در یک سفر هستی. برای حمل‌ونقل باید همان سفر را کامل کنی.",
      show_alert: true,
    });
    return;
  }

  const { data, error } = await supabase
    .from("transport_lines")
    .select(
      `
      id,
      name,
      from_spot_id,
      to_spot_id,
      travel_seconds,
      cost_solen
    `
    )
    .eq("id", lineId)
    .maybeSingle();

  if (error || !data) {
    await ctx.answerCallbackQuery({
      text: "این مسیر حمل‌ونقلی دیگر در دسترس نیست.",
      show_alert: true,
    });
    return;
  }

  const line = data as TransportLineRow;

  const nowIso = new Date().toISOString();

  const ok = await updateCharacter(char.id, {
    movement_mode: "transport",
    travel_state: "in_travel",
    travel_started_at: nowIso,
    travel_duration_seconds: line.travel_seconds,
    travel_from_spot_id: line.from_spot_id,
    travel_to_spot_id: line.to_spot_id,
  });

  if (!ok) {
    await ctx.answerCallbackQuery({
      text: "در شروع سفر حمل‌ونقلی مشکلی پیش آمد.",
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery().catch(() => undefined);

  await ctx.reply(
    `🚂 سفر با ${line.name} آغاز شد.\n` +
      `⏳ زمان تقریبی: ${formatDuration(
        line.travel_seconds
      )}\n\nاین سفر غیرقابل لغو است. وقتی فکر کردی به مقصد رسیدی، /arrive را بزن.`
  );
}

/**
 * ثبت فیچر سفر روی بات
 */
export function registerTravelFeature(bot: Bot<MyContext>) {
  bot.command("path", handleShowPaths);
  bot.hears("🧭 مسیر های من", handleShowPaths);
  bot.hears("🗺 نقشه سریع من", handleQuickMap);
  bot.command("arrive", handleArrive);
  bot.command("transport", handleTransport);

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    if (data.startsWith("travel:edge:")) {
      await handleEdgeTravelCallback(ctx);
    } else if (data.startsWith("travel:transport:")) {
      await handleTransportCallback(ctx);
    }
  });
}
