import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

const INACTIVE_DAYS = 7;

// نمایش «صفحه» در پی‌وی، با پاک کردن پیام قبلی
async function sendScreen(
  ctx: MyContext,
  text: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  if (ctx.chat?.type === "private") {
    const s = (ctx.session as any) || {};
    const lastId: number | undefined = s.ui_last_message_id;
    if (lastId) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, lastId);
      } catch {
        // اگر نتوانست حذف کند، مهم نیست
      }
    }
    const msg = await ctx.reply(text, { reply_markup: keyboard });
    (ctx.session as any).ui_last_message_id = msg.message_id;
  } else {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

function diffDays(fromIso: string): number {
  const from = new Date(fromIso);
  const now = new Date();
  const diffMs = now.getTime() - from.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

async function ensureCharacterFor(
  ctx: MyContext,
  tgId: number
): Promise<any | null> {
  const { supabase } = ctx.services;

  const { data: char, error } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", tgId)
    .maybeSingle();

  if (error) {
    console.error("ensureCharacter select error:", error);
    await ctx.reply("در دسترسی به پروفایل اکلیس مشکلی پیش آمد.");
    return null;
  }

  if (!char) {
    await ctx.reply(
      "هنوز در اکلیس ثبت نشده‌ای.\n" +
        "در پی‌وی من بنویس: «ثبت من» تا فرایند ثبت‌نامت شروع شود."
    );
    return null;
  }

  // حذف بعد از ۷ روز بی‌حرکتی
  if (char.last_move_at && diffDays(char.last_move_at as string) > INACTIVE_DAYS) {
    const { error: delErr } = await supabase
      .from("characters")
      .delete()
      .eq("id", char.id);

    if (delErr) {
      console.error("delete inactive character error:", delErr);
    }

    await ctx.reply(
      "مدت زیادی در اکلیس بی‌حرکت بودی و ردّت از جهان پاک شد.\n" +
        "اگر می‌خواهی برگردی، دوباره با «ثبت من» ثبت‌نام کن."
    );
    return null;
  }

  if (!char.is_approved) {
    await ctx.reply(
      "درخواست ورودت به اکلیس هنوز توسط ارباب تایید نشده است.\n" +
        "بعد از تایید، می‌توانی از مسیرها و نقشه استفاده کنی."
    );
    return null;
  }

  return char;
}

// 🧭 نمایش مسیرها (پیاده)
async function showPaths(ctx: MyContext): Promise<void> {
  if (!ctx.from) return;
  if (ctx.chat?.type !== "private") return;

  const { supabase } = ctx.services;

  const char = await ensureCharacterFor(ctx, ctx.from.id);
  if (!char) return;


  // اگر داخل یک وسیله (راننده یا مسافر) هستی، مسیرهای پیاده در دسترس نیست
  if (char.riding_vehicle_id) {
    await sendScreen(
      ctx,
      "الان سوار یک وسیله‌ی نقلیه هستی.\n" +
        "برای استفاده از مسیرهای پیاده، اول باید از وسیله‌ات پیاده شوی (از منوی «🚗 ماشین های من» یا دکمه «🚶 پیاده شو»)."
    );
    return;
  }


  // اگر هنوز سفر قبلی به پایان نرسیده / ثبت نشده
  if (char.pending_region_id && char.travel_ready_at) {
    const now = new Date();
    const readyAt = new Date(char.travel_ready_at as string);

    const kb = new InlineKeyboard()
      .text("رسیدم؟", "travel:arrive")
      .row()
      .text("لغو مسیر", "travel:cancel");

    if (now < readyAt) {
      const diffMs = readyAt.getTime() - now.getTime();
      const secondsLeft = Math.ceil(diffMs / 1000);

      await sendScreen(
        ctx,
        `⏳ در حال حرکت هستی.\nحدود ${secondsLeft} ثانیه‌ی دیگر تا رسیدن مانده.`,
        kb
      );
      return;
    } else {
      await sendScreen(
        ctx,
        "🌀 زمان سفر قبلی‌ات گذشته است.\n" +
          "برای تکمیلش «رسیدم؟» را بزن یا اگر منصرف شده‌ای «لغو مسیر» را انتخاب کن.",
        kb
      );
      return;
    }
  }

  if (!char.current_spot_id) {
    await sendScreen(
      ctx,
      "هنوز در هیچ نقطه‌ای قرار نگرفته‌ای.\n" +
        "ارباب باید در یکی از گروه‌های Region روی پیامت ریپلای کند و «ثبت پلیر» را بفرستد تا وارد جهان شوی."
    );
    return;
  }

  const { data: spot, error: spotErr } = await supabase
    .from("spots")
    .select("*")
    .eq("id", char.current_spot_id)
    .maybeSingle();

  if (spotErr || !spot) {
    await sendScreen(ctx, "نقطه‌ی فعلی‌ات در نقشه پیدا نشد.");
    return;
  }

  const { data: region, error: regErr } = await supabase
    .from("regions")
    .select("*")
    .eq("id", spot.region_id)
    .maybeSingle();

  if (regErr || !region) {
    await sendScreen(ctx, "Region فعلی‌ات در نقشه پیدا نشد.");
    return;
  }

  if (region.is_locked) {
    await sendScreen(
      ctx,
      "🛑 این Region فعلاً قفل است و راه‌ها بسته‌اند.\n" +
        "تا زمانی که ارباب آن را باز نکند، نمی‌توانی از اینجا حرکت کنی."
    );
    return;
  }

  const { data: edges, error: edgeErr } = await supabase
    .from("edges")
    .select("*")
    .eq("from_spot_id", spot.id)
    .eq("is_locked", false);

  if (edgeErr) {
    console.error("edges select error:", edgeErr);
    await sendScreen(ctx, "در خواندن مسیرها مشکلی پیش آمد.");
    return;
  }

  if (!edges || edges.length === 0) {
    await sendScreen(
      ctx,
      "در برابر تو هیچ مسیری تعریف نشده است.\n" +
        "در پنل جهان‌ساز Edgeها را برای این Spot بساز."
    );
    return;
  }

  const toIds = edges.map((e: any) => e.to_spot_id);

  const { data: destSpots, error: dsErr } = await supabase
    .from("spots")
    .select("*")
    .in("id", toIds);

  if (dsErr || !destSpots) {
    await sendScreen(ctx, "نقاط مقصد مسیرها را نتوانستم پیدا کنم.");
    return;
  }

  const destMap = new Map<number, any>();
  for (const s of destSpots) destMap.set(s.id, s);

  const kb = new InlineKeyboard();
  for (const edge of edges) {
    const dest = destMap.get(edge.to_spot_id);
    const label =
      dest?.title || `نقطه‌ی ناشناخته (#${edge.to_spot_id as number})`;
    const seconds = edge.travel_seconds ?? 0;
    kb.text(`➤ ${label} ~ ${seconds}ث`, `go:${edge.id}`).row();
  }
  kb.text("🔄 تازه‌سازی", "paths:open");

  const text =
    "🧭 مسیرهای قابل حرکت از جایگاه فعلی‌ات:\n" +
    "───────────────\n" +
    `Region: ${region.title}\n` +
    `نقطه فعلی: ${spot.title}\n` +
    "───────────────\n" +
    "راه‌هایی که پیش رویت خودشان را آشکار کرده‌اند:";

  await sendScreen(ctx, text, kb);
}

// 🗺 نقشه سریع
async function showQuickMap(ctx: MyContext): Promise<void> {
  if (!ctx.from) return;
  if (ctx.chat?.type !== "private") return;

  const { supabase } = ctx.services;

  const char = await ensureCharacterFor(ctx, ctx.from.id);
  if (!char) return;

  if (!char.current_region_id || !char.current_spot_id) {
    await sendScreen(
      ctx,
      "هنوز در هیچ Region / Spotـی ثبت نشده‌ای.\n" +
        "ارباب باید در یکی از گروه‌ها روی پیامت ریپلای کند و «ثبت پلیر» را بفرستد."
    );
    return;
  }

  const { data: region, error: regErr } = await supabase
    .from("regions")
    .select("*")
    .eq("id", char.current_region_id)
    .maybeSingle();

  if (regErr || !region) {
    await sendScreen(ctx, "Region فعلی‌ات پیدا نشد.");
    return;
  }

  const { data: spot, error: spotErr } = await supabase
    .from("spots")
    .select("*")
    .eq("id", char.current_spot_id)
    .maybeSingle();

  if (spotErr || !spot) {
    await sendScreen(ctx, "Spot فعلی‌ات پیدا نشد.");
    return;
  }

  const clan = char.clan_name || "بی‌خاندان";
  const name = char.char_name || ctx.from.first_name || "نامشخص";

  const kb = new InlineKeyboard().text("🧭 مسیر های من", "paths:open");

  const text =
    "🗺 نقشه سریع تو\n" +
    "───────────────\n" +
    `شخصیت: ${name}\n` +
    `خاندان: ${clan}\n` +
    `Region: ${region.title}\n` +
    `جایگاه: ${spot.title}\n` +
    "───────────────\n" +
    "برای دیدن راه‌های قابل حرکت، از «🧭 مسیر های من» استفاده کن.";

  await sendScreen(ctx, text, kb);
}

// شروع سفر از روی Edge (پیاده)
async function startTravelFromEdge(ctx: MyContext, edgeId: number): Promise<void> {
  if (!ctx.from) return;
  if (ctx.chat?.type !== "private") return;

  const { supabase } = ctx.services;

  const char = await ensureCharacterFor(ctx, ctx.from.id);
  if (!char) return;

  // اگر سیستم «اول یک پیام بنویس» فعال باشد
  if (char.must_speak_before_travel) {
    const kb = new InlineKeyboard().text("🔙 مسیرها", "paths:open");

    await sendScreen(
      ctx,
      "🗣 پیش از آن‌که دوباره مسیرت را عوض کنی، باید در گروه فعلی‌ات دست‌کم یک پیام بنویسی.\n" +
        "بعد از آن، راه‌ها دوباره برایت باز می‌شوند.",
      kb
    );
    return;
  }

  // قفل بودن Region فعلی
  if (char.current_region_id) {
    const { data: curRegion } = await supabase
      .from("regions")
      .select("*")
      .eq("id", char.current_region_id)
      .maybeSingle();

    if (curRegion?.is_locked) {
      const kb = new InlineKeyboard().text("🔙 مسیرها", "paths:open");

      await sendScreen(
        ctx,
        "🛑 این Region در حال حاضر قفل است و نمی‌توانی از آن حرکت کنی.",
        kb
      );
      return;
    }
  }

  const { data: edge, error: edgeErr } = await supabase
    .from("edges")
    .select("*")
    .eq("id", edgeId)
    .maybeSingle();

  if (edgeErr || !edge) {
    const kb = new InlineKeyboard().text("🔙 مسیرها", "paths:open");
    await sendScreen(ctx, "این مسیر دیگر وجود ندارد.", kb);
    return;
  }

  if (edge.is_locked) {
    const kb = new InlineKeyboard().text("🔙 مسیرها", "paths:open");
    await sendScreen(ctx, "این مسیر اکنون قفل شده و قابل استفاده نیست.", kb);
    return;
  }

  const { data: destSpot, error: dsErr } = await supabase
    .from("spots")
    .select("*")
    .eq("id", edge.to_spot_id)
    .maybeSingle();

  if (dsErr || !destSpot) {
    const kb = new InlineKeyboard().text("🔙 مسیرها", "paths:open");
    await sendScreen(ctx, "نقطه‌ی مقصد این مسیر پیدا نشد.", kb);
    return;
  }

  const { data: destRegion, error: drErr } = await supabase
    .from("regions")
    .select("*")
    .eq("id", destSpot.region_id)
    .maybeSingle();

  if (drErr || !destRegion) {
    const kb = new InlineKeyboard().text("🔙 مسیرها", "paths:open");
    await sendScreen(ctx, "Region مقصد این مسیر پیدا نشد.", kb);
    return;
  }

  if (destRegion.is_locked) {
    const kb = new InlineKeyboard().text("🔙 مسیرها", "paths:open");
    await sendScreen(
      ctx,
      "🛑 مقصد این مسیر فعلاً قفل است و راه بسته شده.",
      kb
    );
    return;
  }

  const baseTravelSeconds: number = edge.travel_seconds || 0;
  const now = new Date();

  const currentCredit: number = char.travel_credit_seconds || 0;
  const creditUsed = Math.min(currentCredit, baseTravelSeconds);
  const effectiveTravelSeconds = baseTravelSeconds - creditUsed;

  const readyAt =
    effectiveTravelSeconds > 0
      ? new Date(now.getTime() + effectiveTravelSeconds * 1000)
      : now;

  const { error: upErr } = await supabase
    .from("characters")
    .update({
      pending_region_id: destRegion.id,
      pending_spot_id: destSpot.id,
      travel_ready_at: readyAt.toISOString(),
      travel_total_seconds: baseTravelSeconds,
      travel_started_at: now.toISOString(),
      last_move_at: now.toISOString(),
      travel_credit_seconds: currentCredit - creditUsed,
    })
    .eq("tg_id", ctx.from.id);

  if (upErr) {
    console.error("characters travel update error:", upErr);
    const kb = new InlineKeyboard().text("🔙 مسیرها", "paths:open");
    await sendScreen(ctx, "در شروع سفر مشکلی پیش آمد.", kb);
    return;
  }

  const kb = new InlineKeyboard()
    .text("رسیدم؟", "travel:arrive")
    .row()
    .text("لغو مسیر", "travel:cancel")
    .row()
    .text("🔙 مسیرها", "paths:open");

  let text =
    "🚶‍♂️ سفر آغاز شد\n" +
    "───────────────\n" +
    `مقصد: ${destRegion.title} / ${destSpot.title}\n` +
    `زمان پایه‌ی سفر: ${baseTravelSeconds} ثانیه.\n`;

  if (creditUsed > 0) {
    text += `اعتبار مصرف‌شده: ${creditUsed} ثانیه.\n`;
  }

  text +=
    `زمان تقریبی این سفر: ${effectiveTravelSeconds} ثانیه.\n` +
    "───────────────\n" +
    "هر وقت فکر کردی زمانش گذشته، «رسیدم؟» را بزن یا /arrive را بفرست.\n" +
    "اگر منصرف شدی، «لغو مسیر» را بزن؛ زمان طی‌شده به عنوان اعتبار برای سفرهای بعدی ذخیره می‌شود.";

  await sendScreen(ctx, text, kb);
}

// رسیدن به مقصد
async function handleArrive(ctx: MyContext): Promise<void> {
  if (!ctx.from) return;
  if (ctx.chat?.type !== "private") return;

  const { supabase } = ctx.services;

  const { data: char, error: charErr } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", ctx.from.id)
    .maybeSingle();

  if (charErr || !char) {
    const kb = new InlineKeyboard().text("🧭 مسیرها", "paths:open");
    await sendScreen(ctx, "هنوز کاراکتری برایت ثبت نشده.", kb);
    return;
  }

  if (!char.is_approved) {
    const kb = new InlineKeyboard().text("🧭 مسیرها", "paths:open");
    await sendScreen(
      ctx,
      "درخواست ثبت‌نامت هنوز توسط ارباب تایید نشده است.",
      kb
    );
    return;
  }

  if (!char.pending_region_id || !char.pending_spot_id || !char.travel_ready_at) {
    const kb = new InlineKeyboard().text("🧭 مسیرها", "paths:open");
    await sendScreen(ctx, "در حال حاضر در سفر نیستی.", kb);
    return;
  }

  const now = new Date();
  const readyAt = new Date(char.travel_ready_at as string);

  if (now < readyAt) {
    const diffMs = readyAt.getTime() - now.getTime();
    const secondsLeft = Math.ceil(diffMs / 1000);

    const kb = new InlineKeyboard()
      .text("🔁 چک دوباره", "travel:arrive")
      .row()
      .text("🔙 مسیرها", "paths:open");

    await sendScreen(
      ctx,
      `⏳ هنوز به مقصد نرسیده‌ای.\nحدود ${secondsLeft} ثانیه‌ی دیگر در راهی.`,
      kb
    );
    return;
  }

  const prevRegionId = char.current_region_id;

  const { data: destRegion } = await supabase
    .from("regions")
    .select("*")
    .eq("id", char.pending_region_id)
    .maybeSingle();

  const { data: destSpot } = await supabase
    .from("spots")
    .select("*")
    .eq("id", char.pending_spot_id)
    .maybeSingle();

  const { error: upErr } = await supabase
    .from("characters")
    .update({
      current_region_id: char.pending_region_id,
      current_spot_id: char.pending_spot_id,
      pending_region_id: null,
      pending_spot_id: null,
      travel_ready_at: null,
      travel_total_seconds: null,
      travel_started_at: null,
      last_move_at: now.toISOString(),
    })
    .eq("id", char.id);
  
  if (upErr) {
    console.error("arrive update error:", upErr);
    const kb = new InlineKeyboard().text("🧭 مسیرها", "paths:open");
    await sendScreen(ctx, "در تکمیل سفر مشکلی پیش آمد.", kb);
    return;
  }

  // تلاش برای کیک از Region قبلی و ساخت لینک مقصد
  let inviteUrl: string | null = null;

  if (destRegion?.telegram_chat_id) {
    try {
      const invite = await ctx.api.createChatInviteLink(
        destRegion.telegram_chat_id as number,
        {
          creates_join_request: false,
          name: `Pathweaver auto-link to ${destRegion.title}`,
        }
      );
      inviteUrl = invite.invite_link;
    } catch (e) {
      console.warn("createChatInviteLink failed:", e);
    }
  }

  if (prevRegionId) {
    const { data: prevRegion } = await supabase
      .from("regions")
      .select("*")
      .eq("id", prevRegionId)
      .maybeSingle();

    if (prevRegion?.telegram_chat_id) {
      try {
        await ctx.api.banChatMember(prevRegion.telegram_chat_id as number, ctx.from.id, {
          until_date: Math.floor(Date.now() / 1000) + 30,
        });
        await ctx.api.unbanChatMember(prevRegion.telegram_chat_id as number, ctx.from.id, {
          only_if_banned: true,
        });
      } catch (e) {
        console.warn("kick from previous region failed:", e);
      }
    }
  }

  const kb = new InlineKeyboard();

  if (inviteUrl) {
    kb.text("🚪 ورود به مکان جدید", inviteUrl);
  } else {
    kb.text("🧭 مسیرها", "paths:open");
  }

  const destRegionTitle = destRegion?.title || "Region نامشخص";
  const destSpotTitle = destSpot?.title || "Spot نامشخص";

  const text =
    "✅ به مقصد رسیدی\n" +
    "───────────────\n" +
    `مکان جدید: ${destRegionTitle} / ${destSpotTitle}\n` +
    "───────────────\n" +
    (inviteUrl
      ? "برای ورود به گروه مقصد، از دکمه‌ی زیر استفاده کن."
      : "لینک مقصد ساخته نشد، اما موقعیتت در دیتابیس به‌روز شد.");

  await sendScreen(ctx, text, kb);
}

// لغو سفر و ذخیره‌ی اعتبار
async function handleCancelTravel(ctx: MyContext): Promise<void> {
  if (!ctx.from) return;
  if (ctx.chat?.type !== "private") return;

  const { supabase } = ctx.services;

  const { data: char, error: charErr } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", ctx.from.id)
    .maybeSingle();

  if (charErr || !char) {
    const kb = new InlineKeyboard().text("🧭 مسیرها", "paths:open");
    await sendScreen(ctx, "هنوز کاراکتری برایت ثبت نشده.", kb);
    return;
  }

  if (!char.pending_region_id || !char.pending_spot_id || !char.travel_ready_at) {
    const kb = new InlineKeyboard().text("🧭 مسیرها", "paths:open");
    await sendScreen(
      ctx,
      "در حال حاضر در سفری نیستی که بتوان آن را لغو کرد.",
      kb
    );
    return;
  }

  const now = new Date();
  const startedAt = char.travel_started_at
    ? new Date(char.travel_started_at as string)
    : null;
  const totalSeconds: number = char.travel_total_seconds || 0;

  let elapsedSeconds = 0;
  if (startedAt) {
    const diffMs = now.getTime() - startedAt.getTime();
    elapsedSeconds = Math.max(0, Math.floor(diffMs / 1000));
  }

  const creditGain = totalSeconds
    ? Math.min(elapsedSeconds, totalSeconds)
    : elapsedSeconds;

  const currentCredit: number = char.travel_credit_seconds || 0;
  const newCredit = currentCredit + creditGain;

  const { error: upErr } = await supabase
    .from("characters")
    .update({
      pending_region_id: null,
      pending_spot_id: null,
      travel_ready_at: null,
      travel_total_seconds: null,
      travel_started_at: null,
      travel_credit_seconds: newCredit,
      last_move_at: now.toISOString(),
    })
    .eq("id", char.id);

  if (upErr) {
    console.error("cancel travel update error:", upErr);
    const kb = new InlineKeyboard().text("🧭 مسیرها", "paths:open");
    await sendScreen(ctx, "در لغو سفر مشکلی پیش آمد؛ دوباره تلاش کن.", kb);
    return;
  }

  const kb = new InlineKeyboard().text("🧭 برگشت به مسیرها", "paths:open");

  const text =
    "❌ سفر فعلی لغو شد\n" +
    "───────────────\n" +
    `زمانی که در راه بودی: ${elapsedSeconds} ثانیه\n` +
    `اعتبار به‌دست‌آمده: ${creditGain} ثانیه\n` +
    `اعتبار فعلی‌ات: ${newCredit} ثانیه\n` +
    "───────────────\n" +
    "در سفرهای بعدی، این اعتبار از زمان مسیرهای جدید کم می‌شود.";

  await sendScreen(ctx, text, kb);
}

export function registerTravelFeature(bot: Bot<MyContext>): void {
  // ثبت پلیر با متن «ثبت پلیر» روی ریپلای
  bot.hears("ثبت پلیر", async (ctx) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      await ctx.reply("🥷🏻 فقط ارباب من میتونه این کار رو انجام بده، حدت رو بدون.");
      return;
    }

    if (!ctx.message?.reply_to_message || !ctx.chat) {
      await ctx.reply(
        "برای ثبت پلیر، باید روی پیام او ریپلای کنی و بعد «ثبت پلیر» را بفرستی."
      );
      return;
    }

    const target = ctx.message.reply_to_message.from;
    if (!target) {
      await ctx.reply("نتوانستم هدف را تشخیص دهم.");
      return;
    }

    const { supabase } = ctx.services;

    const { data: region, error: regErr } = await supabase
      .from("regions")
      .select("*")
      .eq("telegram_chat_id", ctx.chat.id)
      .maybeSingle();

    if (regErr || !region) {
      await ctx.reply(
        "این گروه هنوز به عنوان Region ثبت نشده.\n" +
          "از /worldadmin یا دستورات ساخت Region استفاده کن."
      );

        bot.callbackQuery("ui:home", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await showMainMenu(ctx);
  });
      return;
    }

    const { data: firstSpot, error: spotErr } = await supabase
      .from("spots")
      .select("*")
      .eq("region_id", region.id)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (spotErr || !firstSpot) {
      await ctx.reply(
        "برای این Region هیچ Spotی ثبت نشده.\n" +
          "حداقل یک Spot برای ورودی این Region بساز."
      );
      return;
    }

    const { data: existing, error: charErr } = await supabase
      .from("characters")
      .select("*")
      .eq("tg_id", target.id)
      .maybeSingle();

    if (charErr) {
      await ctx.reply("در بررسی کاراکتر قبلی این پلیر مشکلی پیش آمد.");
      return;
    }

    if (existing) {
      const { error: upErr } = await supabase
        .from("characters")
        .update({
          current_region_id: region.id,
          current_spot_id: firstSpot.id,
          pending_region_id: null,
          pending_spot_id: null,
          travel_ready_at: null,
          last_move_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (upErr) {
        await ctx.reply("در به‌روزرسانی مکان اولیه پلیر مشکلی پیش آمد.");
        return;
      }

      await ctx.reply(
        `پلیر به‌روزرسانی شد ✅\nکاربر: ${target.first_name}\nمکان اولیه: ${region.title} / ${firstSpot.title}`
      );
      return;
    }

    const { error: insErr } = await supabase.from("characters").insert({
      tg_id: target.id,
      char_name: target.first_name,
      current_region_id: region.id,
      current_spot_id: firstSpot.id,
      is_approved: true,
      last_move_at: new Date().toISOString(),
    });

    if (insErr) {
      console.error("insert new character error:", insErr);
      await ctx.reply("در ساخت کاراکتر جدید مشکلی پیش آمد.");
      return;
    }

    await ctx.reply(
      `پلیر جدید ثبت شد ✅\nکاربر: ${target.first_name}\nمکان اولیه: ${region.title} / ${firstSpot.title}`
    );
  });

  // 🧭 مسیرهای من
  bot.hears("🧭 مسیر های من", async (ctx) => {
    await showPaths(ctx);
  });

  // 🗺 نقشه سریع من
  bot.hears("🗺 نقشه سریع من", async (ctx) => {
    await showQuickMap(ctx);
  });

  // /path
  bot.command("path", async (ctx) => {
    await showPaths(ctx);
  });

  // /mymap
  bot.command("mymap", async (ctx) => {
    await showQuickMap(ctx);
  });

  // /arrive و /canceltravel
  bot.command("arrive", handleArrive);
  bot.command("canceltravel", handleCancelTravel);

  // کلیک روی مسیرها / سفر
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;

    if (data === "paths:open") {
      await ctx.answerCallbackQuery();
      await showPaths(ctx);
      return;
    }

    if (data.startsWith("go:")) {
      await ctx.answerCallbackQuery();
      const edgeIdStr = data.substring(3);
      const edgeId = Number(edgeIdStr);
      if (!Number.isFinite(edgeId)) {
        await ctx.reply("شناسه‌ی مسیر نامعتبر است.");
        return;
      }
      await startTravelFromEdge(ctx, edgeId);
      return;
    }

    if (data === "travel:arrive") {
      await ctx.answerCallbackQuery();
      await handleArrive(ctx);
      return;
    }

    if (data === "travel:cancel") {
      await ctx.answerCallbackQuery();
      await handleCancelTravel(ctx);
      return;
    }

    await next();
  });
}

async function sendPvScreen(
  ctx: MyContext,
  text: string,
  keyboard?: InlineKeyboard
) {
  if (ctx.chat?.type === "private") {
    const lastId = (ctx.session as any).ui_last_message_id as
      | number
      | undefined;

    if (lastId) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, lastId);
      } catch {
        // اگر پیام قبلی پاک نشد، بی‌خیال
      }
    }

    const msg = await ctx.reply(text, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });

    (ctx.session as any).ui_last_message_id = msg.message_id;
  } else {
    await ctx.reply(text, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
  }
}

function buildMainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🧭 مسیر های من", "paths:open")
    .row()
    .text("🗺 نقشه سریع من", "mymap:open")
    .row()
    .text("🚗 ماشین های من", "veh:my")
    .row()
    .text("🚕 مسافر شوم", "ui:ride_hint");
}

export async function showMainMenu(ctx: MyContext) {
  await sendPvScreen(
    ctx,
    "<b>نقشه‌ی زنده‌ی اکلیس</b>\n\n" +
      "از اینجا می‌توانی مسیرت را انتخاب کنی، موقعیتت را ببینی، " +
      "یا سراغ ماشین‌ها و مسافربری بروی.",
    buildMainMenu()
  );
}
