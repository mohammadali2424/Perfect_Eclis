import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { supabase } from "../../core/supabase";

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
  id: string;
  name: string | null;
  region_id: string;
}

interface RegionRow {
  id: string;
  name: string | null;
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

const MIN_TRAVEL_SECONDS = 20;

/** گرفتن کاراکتر از روی tg_id */
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

/** گرفتن spot + region برای نمایش قشنگ */
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
    if (spotErr) console.error("getSpotAndRegion spot error", spotErr);
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

/** گرفتن edgeهای قابل حرکت */
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
    if (error) console.error("getAvailableEdges error", error);
    return [];
  }

  const edges = data as EdgeRow[];

  return edges.filter((e) => {
    if (mode === "walk") return e.can_walk;
    if (mode === "ride") return e.can_ride;
    if (mode === "drive") return e.can_drive;
    return false;
  });
}

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

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} ثانیه`;
  const minutes = Math.round(sec / 60);
  return `${minutes} دقیقه`;
}

function modeLabel(mode: MovementMode): string {
  switch (mode) {
    case "walk":
      return "پیاده‌روِ جهان";
    case "ride":
      return "سوارکارِ جانوران";
    case "drive":
      return "راننده‌ی آهن و بخار";
    case "transport":
      return "مسافر قطارها و بالن‌ها";
    default:
      return mode;
  }
}

/** /path و دکمه «🧭 مسیر های من» */
async function handleShowPaths(ctx: MyContext) {
  const char = await getCharacter(ctx);
  if (!char) {
    await ctx.reply(
      "نامت هنوز در دفتر راه‌های اکلیس ثبت نشده.\n" +
        "ادمین باید روی پیامت در یک گروه، ورد /regplayer را بخواند."
    );
    return;
  }
  if (!char.current_spot_id) {
    await ctx.reply(
      "جهان هنوز نمی‌داند تو کجای آن ایستاده‌ای.\n" +
        "این یک خطای تنظیماتیه و باید توسط ارباب نقشه‌ها درست شود."
    );
    return;
  }

  const mode: MovementMode = char.movement_mode || "walk";

  const edges = await getAvailableEdges(char.current_spot_id, mode);
  const { spot, region } = await getSpotAndRegion(char.current_spot_id);

  const regionName = region?.name || "سرزمین نام‌گذاری‌نشده";
  const spotName = spot?.name || "نقطه‌ی بی‌نام";

  let header =
    `📍 اکنون در این نقطه‌ای:\n` +
    `🏞 ریجن: ${regionName}\n` +
    `📌 مکان: ${spotName}\n\n` +
    `🧭 راه‌هایی که از اینجا پیش رویت باز است:\n\n`;

  if (edges.length === 0) {
    await ctx.reply(
      header +
        "در اطرافت هیچ راهی برای حالت حرکت فعلی‌ات باز نیست.\n" +
        "شاید باید از راه دیگری به اینجا متصل شوی یا از ارباب نقشه‌ها کمک بگیری."
    );
    return;
  }

  const kb = new InlineKeyboard();

  edges.forEach((e) => {
    const dur = computeTravelSeconds(e, mode);
    const title = e.name || "مسیر ناشناس";
    const label = `➤ ${title} · ${formatDuration(dur)}`;
    kb.text(label, `travel:edge:${e.id}`).row();
  });

  await ctx.reply(header, { reply_markup: kb });
}

/** دکمه «🗺 نقشه سریع من» */
async function handleQuickMap(ctx: MyContext) {
  const char = await getCharacter(ctx);
  if (!char || !char.current_spot_id) {
    await ctx.reply("نمی‌توانم تو را روی نقشه پیدا کنم. شاید هنوز در مرزهای جهان ثبت نشده‌ای.");
    return;
  }

  const { spot, region } = await getSpotAndRegion(char.current_spot_id);

  const regionName = region?.name || "سرزمین ناشناخته";
  const spotName = spot?.name || "نقطه‌ای بی‌نام";

  const mode = char.movement_mode || "walk";

  const text =
    `🗺 نقشه‌ی جیبی تو:\n\n` +
    `🏞 ریجن: ${regionName}\n` +
    `📍 مکان: ${spotName}\n` +
    `🚶 حالت حرکت: ${modeLabel(mode)}\n`;

  await ctx.reply(text);
}

/** شروع سفر روی edge – callback_data = travel:edge:<id> */
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
      text: "نامت هنوز در دفتر راه‌ها ثبت نشده.",
      show_alert: true,
    });
    return;
  }

  if (!char.current_spot_id) {
    await ctx.answerCallbackQuery({
      text: "مکان فعلی‌ات در نقشه تنظیم نشده.",
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
    if (edgeErr) console.error("edge not found", edgeErr);
    await ctx.answerCallbackQuery({
      text: "این راه دیگر روی نقشه وجود ندارد.",
      show_alert: true,
    });
    return;
  }

  const edge = edgeData as EdgeRow;

  if (mode === "walk" && !edge.can_walk) {
    await ctx.answerCallbackQuery({
      text: "با پای پیاده نمی‌توانی از این راه عبور کنی.",
      show_alert: true,
    });
    return;
  }
  if (mode === "ride" && !edge.can_ride) {
    await ctx.answerCallbackQuery({
      text: "این مسیر برای سوارکاران بسته است.",
      show_alert: true,
    });
    return;
  }
  if (mode === "drive" && !edge.can_drive) {
    await ctx.answerCallbackQuery({
      text: "وسیله‌ی آهنی‌ات اجازه‌ی عبور از این راه را ندارد.",
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
      text: `رد پای سفرت روی راه قبلی، بخشی از مسیر جدید را کوتاه کرد.`,
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
    await ctx.reply("جریان زمان در ثبت این سفر گیر کرد. دوباره تلاش کن.");
    return;
  }

  const { spot: toSpot, region: toRegion } = await getSpotAndRegion(
    edge.to_spot_id
  );

  const targetRegion = toRegion?.name || "سرزمین مبهم";
  const targetSpot = toSpot?.name || "نقطه‌ای بی‌نام";

  const text =
    `🧭 سفر آغاز شد.\n\n` +
    `🎭 حالت حرکت: ${modeLabel(mode)}\n` +
    `🎯 مقصد: ${targetRegion} / ${targetSpot}\n` +
    `⏳ زمان تقریبی: ${formatDuration(duration)}\n\n` +
    `هر وقت فکر کردی به انتهای این راه رسیدی، ورد /arrive را بخوان.`;

  await ctx.reply(text);
}

/** /arrive – رسیدن به مقصد */
async function handleArrive(ctx: MyContext) {
  const char = await getCharacter(ctx);
  if (!char) {
    await ctx.reply("هنوز در دفتر راه‌ها ثبت نشده‌ای.");
    return;
  }

  if (
    char.travel_state !== "in_travel" ||
    !char.travel_started_at ||
    !char.travel_duration_seconds ||
    !char.travel_to_spot_id
  ) {
    await ctx.reply("الان در میانه‌ی هیچ مسیری ثبت نشده‌ای. خبری از سفر فعال نیست.");
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
      `هنوز کمی از این راه باقی مانده…\n` +
        `حدود ${formatDuration(remaining)} دیگر در مسیر خواهی بود.`
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
    await ctx.reply("ثبت رسیدنت در دفتر نقشه به مشکل خورد.");
    return;
  }

  const regionName = region?.name || "سرزمین نامعلوم";
  const spotName = spot?.name || "نقطه‌ی بی‌نام";

  await ctx.reply(
    `✅ به مقصد رسیدی.\n\n` +
      `🏞 ریجن: ${regionName}\n` +
      `📍 مکان: ${spotName}`
  );
}

/** رجیستر فیچر سفر */
export function registerTravelFeature(bot: Bot<MyContext>) {
  // دستور متنی /path
  bot.command("path", handleShowPaths);

  // دکمه متنی «🧭 مسیر های من»
  bot.hears("🧭 مسیر های من", handleShowPaths);

  // دکمه متنی «🗺 نقشه سریع من»
  bot.hears("🗺 نقشه سریع من", handleQuickMap);

  // دستور /arrive
  bot.command("arrive", handleArrive);

  // کال‌بک مسیرها
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    if (data.startsWith("travel:edge:")) {
      await handleEdgeTravelCallback(ctx);
    }
  });
}
