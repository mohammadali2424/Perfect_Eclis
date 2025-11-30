import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

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

  if (!error && char) return char;

  const { data: inserted, error: insErr } = await supabase
    .from("characters")
    .insert({ tg_id: tgId })
    .select("*")
    .maybeSingle();

  if (insErr || !inserted) {
    console.error("ensureCharacter insert error:", insErr);
    await ctx.reply("در ساخت پروفایل اکلیس مشکلی پیش آمد.");
    return null;
  }

  return inserted;
}

async function showPaths(ctx: MyContext): Promise<void> {
  if (!ctx.from) return;
  const { supabase } = ctx.services;

  const char = await ensureCharacterFor(ctx, ctx.from.id);
  if (!char) return;

  if (!char.current_spot_id) {
    await ctx.reply(
      "هنوز در هیچ نقطه‌ای قرار نگرفته‌ای.\n" +
        "ارباب باید در یکی از گروه‌های Region روی پیامت ریپلای کند و /regplayer بزند تا وارد جهان شوی."
    );
    return;
  }

  // Spot فعلی
  const { data: spot, error: spotErr } = await supabase
    .from("spots")
    .select("*")
    .eq("id", char.current_spot_id)
    .maybeSingle();

  if (spotErr || !spot) {
    await ctx.reply("نقطه‌ی فعلی‌ات در نقشه پیدا نشد.");
    return;
  }

  // Region مرتبط با spot
  const { data: region, error: regErr } = await supabase
    .from("regions")
    .select("*")
    .eq("id", spot.region_id)
    .maybeSingle();

  if (regErr || !region) {
    await ctx.reply("Region مرتبط با موقعیت فعلی‌ات پیدا نشد.");
    return;
  }

  // Edgeهای قابل حرکت از spot فعلی
  const { data: edges, error: edgeErr } = await supabase
    .from("edges")
    .select("*")
    .eq("from_spot_id", spot.id);

  if (edgeErr) {
    console.error("edges select error:", edgeErr);
    await ctx.reply("در خواندن مسیرها مشکلی پیش آمد.");
    return;
  }

  if (!edges || edges.length === 0) {
    await ctx.reply(
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
    await ctx.reply("نقاط مقصد مسیرها را نتوانستم پیدا کنم.");
    return;
  }

  const destMap = new Map<number, any>();
  for (const s of destSpots) {
    destMap.set(s.id, s);
  }

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
    "🧭 مسیرهای قابل حرکت از جایگاه فعلی‌ات:\n\n" +
    `Region: ${region.title}\n` +
    `نقطه فعلی: ${spot.title}\n\n` +
    "راه‌هایی که پیش رویت خودشان را آشکار کرده‌اند:";

  const msg = await ctx.reply(text, { reply_markup: kb });
  ctx.session.ui_last_menu_id = msg.message_id;
}

async function showQuickMap(ctx: MyContext): Promise<void> {
  if (!ctx.from) return;
  const { supabase } = ctx.services;

  const char = await ensureCharacterFor(ctx, ctx.from.id);
  if (!char) return;

  if (!char.current_region_id || !char.current_spot_id) {
    await ctx.reply(
      "هنوز مکان فعلی برایت ثبت نشده است.\n" +
        "ارباب باید در یکی از Regionها با /regplayer تو را وارد شهر کند."
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
    "🗺 نقشه سریع تو:\n\n" +
    `شخصیت: ${name}\n` +
    `خاندان: ${clan}\n\n` +
    `Region فعلی: ${region?.title || "نامشخص"}\n` +
    `نقطه فعلی: ${spot?.title || "نامشخص"}\n\n` +
    "برای دیدن راه‌های قابل حرکت از 🧭 «مسیر های من» استفاده کن.";

  await ctx.reply(text);
}

async function startTravelFromEdge(ctx: MyContext, edgeId: number): Promise<void> {
  if (!ctx.from) return;
  const { supabase } = ctx.services;

  const { data: edge, error: edgeErr } = await supabase
    .from("edges")
    .select("*")
    .eq("id", edgeId)
    .maybeSingle();

  if (edgeErr || !edge) {
    await ctx.reply("این مسیر دیگر وجود ندارد.");
    return;
  }

  const { data: destSpot, error: dsErr } = await supabase
    .from("spots")
    .select("*")
    .eq("id", edge.to_spot_id)
    .maybeSingle();

  if (dsErr || !destSpot) {
    await ctx.reply("نقطه‌ی مقصد این مسیر پیدا نشد.");
    return;
  }

  const { data: destRegion, error: drErr } = await supabase
    .from("regions")
    .select("*")
    .eq("id", destSpot.region_id)
    .maybeSingle();

  if (drErr || !destRegion) {
    await ctx.reply("Region مقصد این مسیر پیدا نشد.");
    return;
  }

  const travelSeconds: number = edge.travel_seconds || 0;
  const now = new Date();
  const readyAt = new Date(now.getTime() + travelSeconds * 1000);

  const { error: upErr } = await supabase
    .from("characters")
    .update({
      pending_region_id: destRegion.id,
      pending_spot_id: destSpot.id,
      travel_ready_at: readyAt.toISOString(),
      last_move_at: now.toISOString(),
    })
    .eq("tg_id", ctx.from.id);

  if (upErr) {
    console.error("characters travel update error:", upErr);
    await ctx.reply("در شروع سفر مشکلی پیش آمد.");
    return;
  }

  const kb = new InlineKeyboard().text("رسیدم؟", "travel:arrive");

  await ctx.reply(
    "سفر آغاز شد.\n\n" +
      `مقصد: ${destRegion.title} / ${destSpot.title}\n` +
      `زمان تقریبی سفر: ${travelSeconds} ثانیه.\n\n` +
      "هر وقت فکر کردی زمانش گذشته، روی «رسیدم؟» بزن یا /arrive را ارسال کن.",
    { reply_markup: kb }
  );
}

async function handleArrive(ctx: MyContext): Promise<void> {
  if (!ctx.from) return;
  const { supabase } = ctx.services;

  const { data: char, error: charErr } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", ctx.from.id)
    .maybeSingle();

  if (charErr || !char) {
    await ctx.reply("هنوز کاراکتری برایت ثبت نشده.");
    return;
  }

  if (!char.pending_region_id || !char.pending_spot_id || !char.travel_ready_at) {
    await ctx.reply("در حال حاضر در سفر نیستی.");
    return;
  }

  const now = new Date();
  const readyAt = new Date(char.travel_ready_at as string);

  if (now < readyAt) {
    const diffMs = readyAt.getTime() - now.getTime();
    const secondsLeft = Math.ceil(diffMs / 1000);
    await ctx.reply(`هنوز به مقصد نرسیده‌ای؛ تقریباً ${secondsLeft} ثانیه دیگر مانده.`);
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
    })
    .eq("id", char.id);

  if (upErr) {
    console.error("characters arrive update error:", upErr);
    await ctx.reply("در تکمیل سفر مشکلی پیش آمد.");
    return;
  }

  // تلاش برای kick از گروه قبلی
  if (prevRegionId && destRegion && prevRegionId !== destRegion.id) {
    try {
      const { data: prevRegion } = await supabase
        .from("regions")
        .select("*")
        .eq("id", prevRegionId)
        .maybeSingle();

      if (prevRegion?.telegram_chat_id) {
        try {
          await ctx.api.banChatMember(prevRegion.telegram_chat_id as number, ctx.from.id);
          await ctx.api.unbanChatMember(prevRegion.telegram_chat_id as number, ctx.from.id);
        } catch (e) {
          console.warn("kick/unban from previous region failed:", e);
        }
      }
    } catch (e) {
      console.error("load previous region error:", e);
    }
  }

  // ساخت لینک ورود به گروه مقصد
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
    "به مقصد رسیدی ✅\n\n" +
    `مکان جدیدت:\n${destRegion?.title || "Region نامشخص"} / ${
      destSpot?.title || "Spot نامشخص"
    }`;

  if (inviteLink) {
    const kb = new InlineKeyboard().url("ورود به مکان جدید", inviteLink);
    await ctx.reply(text, { reply_markup: kb });
  } else {
    text +=
      "\n\n(نتوانستم لینک دعوت گروه مقصد را بسازم؛ مطمئن شو من ادمین گروه مقصد هستم.)";
    await ctx.reply(text);
  }
}

export function registerTravelFeature(bot: Bot<MyContext>): void {
  // /regplayer فقط برای ارباب در گروه‌های Region
  bot.command("regplayer", async (ctx) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      await ctx.reply("فقط اربابم می‌تواند پلیرها را در Regionها ثبت کند.");
      return;
    }

    if (!ctx.chat || ctx.chat.type === "private") {
      await ctx.reply("باید این دستور را داخل گروه Region بفرستی، نه در پی‌وی.");
      return;
    }

    const replyTo = ctx.message?.reply_to_message;
    if (!replyTo || !replyTo.from) {
      await ctx.reply(
        "برای استفاده از /regplayer باید روی پیام بازیکن ریپلای کنی و بعد دستور را بفرستی."
      );
      return;
    }

    const { supabase } = ctx.services;
    const chatId = ctx.chat.id;

    // پیدا کردن Region مرتبط با این گروه
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

    // اولین Spot این Region
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

  // 🧭 مسیر های من یا /path در پی‌وی
  bot.command("path", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await showPaths(ctx);
  });

  bot.hears("🧭 مسیر های من", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await showPaths(ctx);
  });

  // 🗺 نقشه سریع من یا /mymap در پی‌وی
  bot.command("mymap", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await showQuickMap(ctx);
  });

  bot.hears("🗺 نقشه سریع من", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await showQuickMap(ctx);
  });

  // /arrive برای چک‌کردن رسیدن
  bot.command("arrive", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await handleArrive(ctx);
  });

  // مدیریت callbackهای سفر
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";

    if (data === "paths:open") {
      await ctx.answerCallbackQuery();
      if (ctx.chat?.type === "private") {
        await showPaths(ctx);
      }
      return;
    }

    if (data.startsWith("go:")) {
      await ctx.answerCallbackQuery();
      const idStr = data.split(":")[1];
      const edgeId = Number(idStr);
      if (!Number.isNaN(edgeId)) {
        await startTravelFromEdge(ctx, edgeId);
      } else {
        await ctx.reply("شناسه‌ی مسیر نامعتبر است.");
      }
      return;
    }

    if (data === "travel:arrive") {
      await ctx.answerCallbackQuery();
      await handleArrive(ctx);
      return;
    }

    await next();
  });
}
