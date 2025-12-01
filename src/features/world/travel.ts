import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

const INACTIVE_DAYS = 7;

// کمک‌کننده برای حالت «صفحه» در پی‌وی
async function sendScreen(
  ctx: MyContext,
  text: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  const isCallback = !!ctx.callbackQuery?.message;
  if (isCallback) {
    try {
      await ctx.editMessageText(text, {
        reply_markup: keyboard,
      });
      return;
    } catch (e) {
      console.warn("editMessageText failed, falling back to reply:", e);
    }
  }
  await ctx.reply(text, { reply_markup: keyboard });
}

function diffDays(fromIso: string): number {
  const from = new Date(fromIso);
  const now = new Date();
  const diffMs = now.getTime() - from.getTime();
  return diffMs / (1000 * 60 * 60 * 24);
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
      "بیش از یک هفته در اکلیس بی‌حرکت بوده‌ای و از ربات حذف شدی.\n" +
        "اگر می‌خواهی برگردی، دوباره در پی‌وی بنویس «ثبت من»."
    );
    return null;
  }

  if (!char.is_approved) {
    await ctx.reply(
      "درخواست ثبت‌نامت هنوز توسط ارباب تایید نشده است.\n" +
        "وقتی تایید شد، می‌توانی از مسیرها و نقشه استفاده کنی."
    );
    return null;
  }

  // آپدیت آخرین فعالیت
  const nowIso = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("characters")
    .update({ last_move_at: nowIso })
    .eq("id", char.id);

  if (upErr) {
    console.error("update last_move_at error:", upErr);
  }

  return { ...char, last_move_at: nowIso };
}

// 🧭 مسیر ها
async function showPaths(ctx: MyContext): Promise<void> {
  if (!ctx.from) return;
  if (ctx.chat?.type !== "private") return;

  const { supabase } = ctx.services;

  const char = await ensureCharacterFor(ctx, ctx.from.id);
  if (!char) return;

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
    await sendScreen(ctx, "Region مرتبط با موقعیت فعلی‌ات پیدا نشد.");
    return;
  }

  const { data: edges, error: edgeErr } = await supabase
    .from("edges")
    .select("*")
    .eq("from_spot_id", spot.id);

  if (edgeErr) {
    console.error("edges select error:", edgeErr);
    await sendScreen(ctx, "در خواندن مسیرها مشکلی پیش آمد.");
    return;
  }

  if (!edges || edges.length === 0) {
    await sendScreen(
      ctx,
      "در برابر تو هیچ مسیری تعریف نشده است.\n" +
        "در Supabase جدول edges را برای این Spot پر کن تا راه‌ها آشکار شوند."
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
      "هنوز مکان فعلی برایت ثبت نشده است.\n" +
        "ارباب باید در یکی از Regionها با «ثبت پلیر» تو را وارد شهر کند."
    );
    return;
  }

  const { data: region } = await supabase
    .from("regions")
    .select("*")
    .eq("id", char.current_region_id)
    .maybeSingle();

  const { data: spot } = await supabase
    .from("spots")
    .select("*")
    .eq("id", char.current_spot_id)
    .maybeSingle();

  const clan = char.clan_name || "بی‌خاندان";
  const name = char.char_name || ctx.from.first_name || "نامشخص";

  const text =
    "🗺 نقشه سریع تو\n" +
    "───────────────\n" +
    `شخصیت: ${name}\n` +
    `خاندان: ${clan}\n` +
    "───────────────\n" +
    `Region فعلی: ${region?.title || "نامشخص"}\n` +
    `نقطه فعلی: ${spot?.title || "نامشخص"}\n` +
    "───────────────\n" +
    "برای دیدن راه‌های قابل حرکت از 🧭 «مسیر های من» استفاده کن.";

  await sendScreen(ctx, text);
}

// شروع سفر از روی Edge
async function startTravelFromEdge(ctx: MyContext, edgeId: number): Promise<void> {
  if (!ctx.from) return;
  if (ctx.chat?.type !== "private") return;

  const { supabase } = ctx.services;

  const char = await ensureCharacterFor(ctx, ctx.from.id);
  if (!char) return;

  const { data: edge, error: edgeErr } = await supabase
    .from("edges")
    .select("*")
    .eq("id", edgeId)
    .maybeSingle();

  if (edgeErr || !edge) {
    await sendScreen(ctx, "این مسیر دیگر وجود ندارد.");
    return;
  }

  const { data: destSpot, error: dsErr } = await supabase
    .from("spots")
    .select("*")
    .eq("id", edge.to_spot_id)
    .maybeSingle();

  if (dsErr || !destSpot) {
    await sendScreen(ctx, "نقطه‌ی مقصد این مسیر پیدا نشد.");
    return;
  }

  const { data: destRegion, error: drErr } = await supabase
    .from("regions")
    .select("*")
    .eq("id", destSpot.region_id)
    .maybeSingle();

  if (drErr || !destRegion) {
    await sendScreen(ctx, "Region مقصد این مسیر پیدا نشد.");
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
    await sendScreen(ctx, "در شروع سفر مشکلی پیش آمد.");
    return;
  }

  const kb = new InlineKeyboard()
    .text("رسیدم؟", "travel:arrive")
    .text("لغو مسیر", "travel:cancel");

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
    await sendScreen(ctx, "هنوز کاراکتری برایت ثبت نشده.");
    return;
  }

  if (!char.is_approved) {
    await sendScreen(ctx, "درخواست ثبت‌نامت هنوز توسط ارباب تایید نشده است.");
    return;
  }

  if (!char.pending_region_id || !char.pending_spot_id || !char.travel_ready_at) {
    await sendScreen(ctx, "در حال حاضر در سفر نیستی.");
    return;
  }

  const now = new Date();
  const readyAt = new Date(char.travel_ready_at as string);

  if (now < readyAt) {
    const diffMs = readyAt.getTime() - now.getTime();
    const secondsLeft = Math.ceil(diffMs / 1000);
    await sendScreen(
      ctx,
      `⏳ هنوز به مقصد نرسیده‌ای.\nحدود ${secondsLeft} ثانیه‌ی دیگر در راهی.`
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
      last_move_at: new Date().toISOString(),
    })
    .eq("id", char.id);

  if (upErr) {
    console.error("characters arrive update error:", upErr);
    await sendScreen(
      ctx,
      "در تکمیل سفر مشکلی پیش آمد.\nلوکیشن در دیتابیس به‌روزرسانی نشد؛ سفر را دوباره امتحان کن."
    );
    return;
  }

  if (prevRegionId && destRegion && prevRegionId !== destRegion.id) {
    try {
      const { data: prevRegion } = await supabase
        .from("regions")
        .select("*")
        .eq("id", prevRegionId)
        .maybeSingle();

      if (prevRegion?.telegram_chat_id) {
        try {
          await ctx.api.banChatMember(
            prevRegion.telegram_chat_id as number,
            ctx.from.id
          );
          await ctx.api.unbanChatMember(
            prevRegion.telegram_chat_id as number,
            ctx.from.id
          );
        } catch (e) {
          console.warn("kick/unban from previous region failed:", e);
        }
      }
    } catch (e) {
      console.error("load previous region error:", e);
    }
  }

  let inviteLink: string | null = null;
  if (destRegion?.telegram_chat_id) {
    try {
      const link = await ctx.api.createChatInviteLink(
        destRegion.telegram_chat_id as number,
        {
          name: `ورود ${ctx.from.first_name} به ${destRegion.title}`,
        } as any
      );
      inviteLink = link.invite_link;
    } catch (e) {
      console.error("createChatInviteLink failed:", e);
    }
  }

  let text =
    "✅ به مقصد رسیدی\n" +
    "───────────────\n" +
    `مکان جدیدت:\n${destRegion?.title || "Region نامشخص"}\n` +
    `${destSpot?.title || "Spot نامشخص"}`;

  if (inviteLink) {
    const kb = new InlineKeyboard().url("ورود به مکان جدید", inviteLink);
    await sendScreen(ctx, text, kb);
  } else {
    text +=
      "\n\n(نتوانستم لینک دعوت گروه مقصد را بسازم؛ مطمئن شو من ادمین گروه مقصد هستم.)";
    await sendScreen(ctx, text);
  }
}

// لغو سفر + اعتبار
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
    await sendScreen(ctx, "هنوز کاراکتری برایت ثبت نشده.");
    return;
  }

  if (!char.pending_region_id || !char.pending_spot_id || !char.travel_ready_at) {
    await sendScreen(ctx, "در حال حاضر در سفری نیستی که بتوان آن را لغو کرد.");
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
    await sendScreen(ctx, "در لغو سفر مشکلی پیش آمد؛ دوباره تلاش کن.");
    return;
  }

  const text =
    "❌ سفر فعلی لغو شد\n" +
    "───────────────\n" +
    `زمانی که در راه بودی: ${elapsedSeconds} ثانیه\n` +
    `اعتبار به‌دست‌آمده: ${creditGain} ثانیه\n` +
    `اعتبار فعلی‌ات: ${newCredit} ثانیه\n` +
    "───────────────\n" +
    "در سفرهای بعدی، این اعتبار از زمان مسیرهای جدید کم می‌شود.";

  await sendScreen(ctx, text);
}

export function registerTravelFeature(bot: Bot<MyContext>): void {
  // ثبت پلیر با متن «ثبت پلیر» روی ریپلای
  bot.hears("ثبت پلیر", async (ctx) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      await ctx.reply("🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون");
      return;
    }

    if (!ctx.chat || ctx.chat.type === "private") {
      await ctx.reply("باید این دستور را داخل گروه Region بفرستی، نه در پی‌وی.");
      return;
    }

    const replyTo = ctx.message?.reply_to_message;
    if (!replyTo || !replyTo.from) {
      await ctx.reply(
        "برای استفاده از «ثبت پلیر» باید روی پیام بازیکن ریپلای کنی و بعد این متن را بفرستی."
      );
      return;
    }

    const { supabase } = ctx.services;
    const chatId = ctx.chat.id;

    const { data: region, error: regErr } = await supabase
      .from("regions")
      .select("*")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();

    if (regErr || !region) {
      await ctx.reply(
        "این گروه هنوز به عنوان Region ثبت نشده است.\n" +
          "اول /worldadmin را اینجا بزن تا به عنوان Region ثبت شود."
      );
      return;
    }

    const { data: spot, error: spotErr } = await supabase
      .from("spots")
      .select("*")
      .eq("region_id", region.id)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (spotErr || !spot) {
      await ctx.reply(
        "برای این Region هنوز هیچ Spotی تعریف نشده.\n" +
          "در Supabase جدول spots را برای این Region پر کن."
      );
      return;
    }

    const playerId = replyTo.from.id;

    const { data: existing, error: exErr } = await supabase
      .from("characters")
      .select("*")
      .eq("tg_id", playerId)
      .maybeSingle();

    if (exErr) {
      console.error("characters select for ثبت پلیر error:", exErr);
      await ctx.reply("در ثبت پلیر مشکلی پیش آمد.");
      return;
    }

    if (existing) {
      const { error: upErr } = await supabase
        .from("characters")
        .update({
          current_region_id: region.id,
          current_spot_id: spot.id,
          pending_region_id: null,
          pending_spot_id: null,
        })
        .eq("id", existing.id);

      if (upErr) {
        console.error("characters update in ثبت پلیر error:", upErr);
        await ctx.reply("در به‌روزرسانی مکان پلیر مشکلی پیش آمد.");
        return;
      }
    } else {
      const { error: insErr } = await supabase.from("characters").insert({
        tg_id: playerId,
        current_region_id: region.id,
        current_spot_id: spot.id,
      });

      if (insErr) {
        console.error("characters insert in ثبت پلیر error:", insErr);
        await ctx.reply("در ثبت پلیر جدید مشکلی پیش آمد.");
        return;
      }
    }

    await ctx.reply(
      "پلیر ثبت شد ✅\n" +
        `کاربر: ${replyTo.from.first_name}${
          replyTo.from.last_name ? " " + replyTo.from.last_name : ""
        }\n` +
        `مکان اولیه: ${region.title} / ${spot.title}`
    );
  });

  // نسخه قدیمی /regplayer
  bot.command("regplayer", async (ctx) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      await ctx.reply("🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون");
      return;
    }

    if (!ctx.chat || ctx.chat.type === "private") {
      await ctx.reply("باید این دستور را داخل گروه Region بفرستی، نه در پی‌وی.");
      return;
    }

    const replyTo = ctx.message?.reply_to_message;
    if (!replyTo || !replyTo.from) {
      await ctx.reply(
        "برای استفاده از /regplayer باید روی پیام بازیکن ریپلای کنی."
      );
      return;
    }

    const { supabase } = ctx.services;
    const chatId = ctx.chat.id;

    const { data: region, error: regErr } = await supabase
      .from("regions")
      .select("*")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();

    if (regErr || !region) {
      await ctx.reply(
        "این گروه هنوز به عنوان Region ثبت نشده است.\n" +
          "اول /worldadmin را اینجا بزن تا به عنوان Region ثبت شود."
      );
      return;
    }

    const { data: spot, error: spotErr } = await supabase
      .from("spots")
      .select("*")
      .eq("region_id", region.id)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (spotErr || !spot) {
      await ctx.reply(
        "برای این Region هنوز هیچ Spotی تعریف نشده.\n" +
          "در Supabase جدول spots را برای این Region پر کن."
      );
      return;
    }

    const playerId = replyTo.from.id;

    const { data: existing, error: exErr } = await supabase
      .from("characters")
      .select("*")
      .eq("tg_id", playerId)
      .maybeSingle();

    if (exErr) {
      console.error("characters select for regplayer error:", exErr);
      await ctx.reply("در ثبت پلیر مشکلی پیش آمد.");
      return;
    }

    if (existing) {
      const { error: upErr } = await supabase
        .from("characters")
        .update({
          current_region_id: region.id,
          current_spot_id: spot.id,
          pending_region_id: null,
          pending_spot_id: null,
        })
        .eq("id", existing.id);

      if (upErr) {
        console.error("characters update in regplayer error:", upErr);
        await ctx.reply("در به‌روزرسانی مکان پلیر مشکلی پیش آمد.");
        return;
      }
    } else {
      const { error: insErr } = await supabase.from("characters").insert({
        tg_id: playerId,
        current_region_id: region.id,
        current_spot_id: spot.id,
      });

      if (insErr) {
        console.error("characters insert in regplayer error:", insErr);
        await ctx.reply("در ثبت پلیر جدید مشکلی پیش آمد.");
        return;
      }
    }

    await ctx.reply(
      "پلیر ثبت شد ✅\n" +
        `کاربر: ${replyTo.from.first_name}${
          replyTo.from.last_name ? " " + replyTo.from.last_name : ""
        }\n` +
        `مکان اولیه: ${region.title} / ${spot.title}`
    );
  });

  // 🧭 مسیر های من
  bot.command("path", async (ctx) => {
    await showPaths(ctx);
  });
  bot.hears("🧭 مسیر های من", async (ctx) => {
    await showPaths(ctx);
  });

  // 🗺 نقشه سریع من
  bot.command("mymap", async (ctx) => {
    await showQuickMap(ctx);
  });
  bot.hears("🗺 نقشه سریع من", async (ctx) => {
    await showQuickMap(ctx);
  });

  // /arrive
  bot.command("arrive", async (ctx) => {
    await handleArrive(ctx);
  });

  // callbackهای سفر
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";

    if (data === "paths:open") {
      await ctx.answerCallbackQuery();
      await showPaths(ctx);
      return;
    }

    if (data.startsWith("go:")) {
      await ctx.answerCallbackQuery();
      const idStr = data.split(":")[1];
      const edgeId = Number(idStr);
      if (!Number.isNaN(edgeId)) {
        await startTravelFromEdge(ctx, edgeId);
      } else {
        await sendScreen(ctx, "شناسه‌ی مسیر نامعتبر است.");
      }
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
