import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

const INACTIVE_DAYS = 7;

// --- helper: پاک کردن پیام قبلی و ساخت یک صفحه‌ی جدید در PV ---

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
        // مهم نیست اگر پاک نشد
      }
    }
    const msg = await ctx.reply(text, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
    (ctx.session as any).ui_last_message_id = msg.message_id;
  } else {
    await ctx.reply(text, { reply_markup: keyboard, parse_mode: "HTML" });
  }
}

// --- helper: گرفتن / ساختن کاراکتر بر اساس tg_id ---

async function ensureCharacterFor(
  ctx: MyContext,
  tgId: number
): Promise<any | null> {
  const { supabase } = ctx.services;

  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", tgId)
    .maybeSingle();

  if (error) {
    console.error("ensureCharacterFor select error:", error);
    await ctx.reply("در خواندن اطلاعات شخصیتت مشکلی پیش آمد.");
    return null;
  }

  if (data) return data;

  // اگر شخصیت هنوز ثبت نشده باشد، یک سطر مینیمال می‌سازیم
  const insert = {
    tg_id: tgId,
    char_name: null,
    clan_name: null,
    current_region_id: null,
    current_spot_id: null,
    pending_region_id: null,
    pending_spot_id: null,
    travel_ready_at: null,
    travel_total_seconds: null,
    travel_started_at: null,
    last_move_at: null,
    riding_vehicle_id: null,
  };

  const { data: ins, error: insErr } = await supabase
    .from("characters")
    .insert(insert)
    .select("*")
    .maybeSingle();

  if (insErr || !ins) {
    console.error("ensureCharacterFor insert error:", insErr);
    await ctx.reply("نتوانستم شخصیتت را بسازم.");
    return null;
  }

  return ins;
}

// --- منوی اصلی PV ---

function buildMainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🧭 مسیر های من", "paths:open")
    .row()
    .text("🗺 نقشه سریع من", "mymap:open")
    .row()
    .text("🚗 ماشین های من", "veh:my")
    .row()
    .text("🚕 مسافر شوم", "ride:menu");
}

// --- نمایش مسیرهای قابل حرکت از Spot فعلی ---

async function openPaths(ctx: MyContext): Promise<void> {
  if (!ctx.from) return;
  if (ctx.chat?.type !== "private") return;

  const { supabase } = ctx.services;
  const char = await ensureCharacterFor(ctx, ctx.from.id);
  if (!char) return;

  if (!char.current_region_id || !char.current_spot_id) {
    await sendScreen(
      ctx,
      "هنوز در هیچ Region / Spotـی ثبت نشده‌ای.\n" +
        "ارباب باید در یکی از گروه‌ها روی پیامت ریپلای کند و «ثبت پلیر» را بفرستد.",
      buildMainMenu()
    );
    return;
  }

  // خواندن Spot و Region فعلی
  const { data: spot, error: spotErr } = await supabase
    .from("spots")
    .select("*")
    .eq("id", char.current_spot_id)
    .maybeSingle();

  const { data: region, error: regErr } = await supabase
    .from("regions")
    .select("*")
    .eq("id", char.current_region_id)
    .maybeSingle();

  if (spotErr || regErr || !spot || !region) {
    console.error("openPaths region/spot error:", spotErr || regErr);
    await sendScreen(
      ctx,
      "در خواندن موقعیت فعلی‌ات مشکلی پیش آمد.",
      buildMainMenu()
    );
    return;
  }

  // لود Edges از این Spot
  const { data: edges, error: edgeErr } = await supabase
    .from("edges")
    .select("id, from_spot_id, to_spot_id, travel_seconds, drive_seconds")
    .eq("from_spot_id", spot.id);

  if (edgeErr) {
    console.error("openPaths edges error:", edgeErr);
    await sendScreen(
      ctx,
      "در خواندن مسیرهای اطراف مشکلی پیش آمد.",
      buildMainMenu()
    );
    return;
  }

  if (!edges || edges.length === 0) {
    await sendScreen(
      ctx,
      `📍 موقعیت فعلی:\nRegion: ${region.title}\nSpot: ${spot.title}\n\n` +
        "هیچ مسیری از این نقطه تعریف نشده.",
      buildMainMenu()
    );
    return;
  }

  // مقصدها را بخوانیم تا اسم Spotها را نمایش دهیم
  const toSpotIds = edges.map((e: any) => e.to_spot_id);
  const { data: toSpots, error: toSpotErr } = await supabase
    .from("spots")
    .select("id, title, region_id")
    .in("id", toSpotIds);

  if (toSpotErr) {
    console.error("openPaths toSpots error:", toSpotErr);
  }

  const toSpotMap = new Map<number, any>();
  (toSpots ?? []).forEach((s: any) => {
    toSpotMap.set(s.id, s);
  });

  // ببینیم آیا سوار ماشین هستی
  let ridingVehicle: any | null = null;
  let isDriver = false;

  if (char.riding_vehicle_id) {
    const { data: vehicle, error: vehErr } = await supabase
      .from("vehicles")
      .select("id, title, owner_char_id")
      .eq("id", char.riding_vehicle_id)
      .maybeSingle();

    if (!vehErr && vehicle) {
      ridingVehicle = vehicle;
      if (vehicle.owner_char_id === char.id) {
        isDriver = true;
      }
    }
  }

  const kb = new InlineKeyboard();

  let textHeader =
    `📍 موقعیت فعلی:\nRegion: ${region.title}\nSpot: ${spot.title}\n`;

  if (char.clan_name) {
    textHeader += `خاندان: ${char.clan_name}\n`;
  }

  if (ridingVehicle && isDriver) {
    textHeader += `\n🚗 وضعیت: راننده‌ی «${ridingVehicle.title}» هستی.\n`;
  } else if (ridingVehicle && !isDriver) {
    textHeader += `\n🚕 وضعیت: مسافر روی «${ridingVehicle.title}» هستی.\n`;
  } else {
    textHeader += `\n🚶 وضعیت: پیاده‌ای.\n`;
  }

  textHeader += "\nراه‌هایی که از این نقطه در برابر تو آشکار می‌شوند:\n\n";

  let textBody = "";

  if (ridingVehicle && !isDriver) {
    // مسافر → راننده باید مسیر را انتخاب کند
    textBody +=
      "تو به عنوان مسافر سوار هستی؛ فقط راننده می‌تواند مسیر را انتخاب کند.\n";
  } else if (ridingVehicle && isDriver) {
    // رانندگی
    for (const e of edges) {
      const dest = toSpotMap.get(e.to_spot_id);
      const destTitle = dest?.title ?? `Spot #${e.to_spot_id}`;
      const driveSec =
        e.drive_seconds ?? e.travel_seconds ?? 0;

      textBody += `🚗 ➤ ${destTitle} ~ ${driveSec} ثانیه‌ی رانندگی\n`;
      kb
        .text(
          `🚗 ${destTitle} (${driveSec}s)`,
          `veh:go:${e.id}:${ridingVehicle.id}`
        )
        .row();
    }
  } else {
    // پیاده‌روی
    for (const e of edges) {
      const dest = toSpotMap.get(e.to_spot_id);
      const destTitle = dest?.title ?? `Spot #${e.to_spot_id}`;
      const walkSec = e.travel_seconds ?? 0;

      textBody += `➤ ${destTitle} ~ ${walkSec} ثانیه‌ی سفر پیاده\n`;
      kb.text(`➤ ${destTitle} (${walkSec}s)`, `go:${e.id}`).row();
    }
  }

  kb.text("🔄 تازه‌سازی", "paths:open").row().text("🏠 منوی اصلی", "ui:home");

  await sendScreen(ctx, textHeader + textBody, kb);
}

// --- شروع سفر پیاده از روی Edge ---

async function startWalkTravel(ctx: MyContext, edgeId: number): Promise<void> {
  if (!ctx.from) return;
  const { supabase } = ctx.services;

  const char = await ensureCharacterFor(ctx, ctx.from.id);
  if (!char) return;

  if (!char.current_spot_id || !char.current_region_id) {
    await ctx.answerCallbackQuery({
      text: "موقعیت فعلی‌ات مشخص نیست.",
      show_alert: true,
    });
    return;
  }

  const { data: edge, error: edgeErr } = await supabase
    .from("edges")
    .select("id, from_spot_id, to_spot_id, travel_seconds")
    .eq("id", edgeId)
    .maybeSingle();

  if (edgeErr || !edge) {
    await ctx.answerCallbackQuery({
      text: "این مسیر دیگر در دسترس نیست.",
      show_alert: true,
    });
    return;
  }

  if (edge.from_spot_id !== char.current_spot_id) {
    await ctx.answerCallbackQuery({
      text: "از این نقطه نمی‌توانی وارد این مسیر شوی.",
      show_alert: true,
    });
    return;
  }

  const { data: destSpot, error: dsErr } = await supabase
    .from("spots")
    .select("id, region_id, title")
    .eq("id", edge.to_spot_id)
    .maybeSingle();

  if (dsErr || !destSpot) {
    await ctx.answerCallbackQuery({
      text: "نقطه‌ی مقصد پیدا نشد.",
      show_alert: true,
    });
    return;
  }

  const { data: destRegion, error: drErr } = await supabase
    .from("regions")
    .select("*")
    .eq("id", destSpot.region_id)
    .maybeSingle();

  if (drErr || !destRegion) {
    await ctx.answerCallbackQuery({
      text: "منطقه‌ی مقصد پیدا نشد.",
      show_alert: true,
    });
    return;
  }

  const travelSeconds = edge.travel_seconds ?? 0;
  if (travelSeconds <= 0) {
    await ctx.answerCallbackQuery({
      text: "زمان این مسیر درست تنظیم نشده.",
      show_alert: true,
    });
    return;
  }

  const now = new Date();
  const readyAt = new Date(now.getTime() + travelSeconds * 1000);

  const { error: updErr } = await supabase
    .from("characters")
    .update({
      pending_region_id: destRegion.id,
      pending_spot_id: destSpot.id,
      travel_started_at: now.toISOString(),
      travel_ready_at: readyAt.toISOString(),
      travel_total_seconds: travelSeconds,
      last_move_at: now.toISOString(),
    })
    .eq("id", char.id);

  if (updErr) {
    console.error("startWalkTravel update error:", updErr);
    await ctx.answerCallbackQuery({
      text: "در شروع سفر مشکلی پیش آمد.",
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery({
    text: "سفر آغاز شد.",
    show_alert: false,
  });

  const kb = new InlineKeyboard()
    .text("🚶 رسیدم؟", "travel:arrive")
    .row()
    .text("🏠 منوی اصلی", "ui:home");

  await sendScreen(
    ctx,
    `🚶 در حال حرکت به سمت «${destRegion.title} / ${destSpot.title}» هستی.\n` +
      `زمان تقریبی سفر: ${travelSeconds} ثانیه.\n\n` +
      "هر وقت فکر کردی زمانش گذشته، روی «رسیدم؟» بزن یا /arrive را بفرست.",
    kb
  );
}

// --- رسیدن به مقصد (پیاده + راننده‌ی ماشین + مسافرها) ---

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
    await ctx.reply("شخصیتت پیدا نشد.");
    return;
  }

  if (!char.pending_region_id || !char.pending_spot_id || !char.travel_ready_at) {
    await sendScreen(
      ctx,
      "الان در حال سفر نیستی.\n" +
        "برای حرکت جدید از «🧭 مسیر های من» استفاده کن.",
      buildMainMenu()
    );
    return;
  }

  const now = new Date();
  const readyAt = new Date(char.travel_ready_at);

  if (now < readyAt) {
    const remainSec = Math.ceil((readyAt.getTime() - now.getTime()) / 1000);
    await sendScreen(
      ctx,
      `هنوز به مقصد نرسیده‌ای.\n` +
        `حدود ${remainSec} ثانیه‌ی دیگر باقی مانده.`,
      buildMainMenu()
    );
    return;
  }

  // مقصد
  const { data: destSpot, error: dsErr } = await supabase
    .from("spots")
    .select("id, region_id, title")
    .eq("id", char.pending_spot_id)
    .maybeSingle();

  if (dsErr || !destSpot) {
    console.error("arrive destSpot error:", dsErr);
    await sendScreen(
      ctx,
      "نقطه‌ی مقصد پیدا نشد، اما سفر را پایان دادم.",
      buildMainMenu()
    );
    return;
  }

  const { data: destRegion, error: drErr } = await supabase
    .from("regions")
    .select("*")
    .eq("id", destSpot.region_id)
    .maybeSingle();

  if (drErr || !destRegion) {
    console.error("arrive destRegion error:", drErr);
  }

  const prevRegionId: number | null = char.current_region_id ?? null;

  // آپدیت کاراکتر فعلی
  const { error: updErr } = await supabase
    .from("characters")
    .update({
      current_region_id: destSpot.region_id,
      current_spot_id: destSpot.id,
      pending_region_id: null,
      pending_spot_id: null,
      travel_started_at: null,
      travel_ready_at: null,
      travel_total_seconds: null,
      last_move_at: now.toISOString(),
    })
    .eq("id", char.id);

  if (updErr) {
    console.error("arrive update char error:", updErr);
  }

  // Region قبلی را لود کنیم برای کیک
  let prevRegion: any | null = null;
  if (prevRegionId) {
    const { data: pr } = await supabase
      .from("regions")
      .select("*")
      .eq("id", prevRegionId)
      .maybeSingle();
    prevRegion = pr ?? null;
  }

  // کیک از گروه قبلی برای خود کاراکتر
  if (prevRegion && prevRegion.telegram_chat_id) {
    try {
      await ctx.api.banChatMember(
        prevRegion.telegram_chat_id as number,
        ctx.from.id,
        {
          until_date: Math.floor(Date.now() / 1000) + 30,
        }
      );
      await ctx.api.unbanChatMember(
        prevRegion.telegram_chat_id as number,
        ctx.from.id,
        { only_if_banned: true }
      );
    } catch (e) {
      console.warn("kick from previous region failed:", e);
    }
  }

  // دعوت‌نامه‌ی گروه مقصد
  let inviteUrl: string | null = null;
  if (destRegion && destRegion.telegram_chat_id) {
    try {
      const link = await ctx.api.createChatInviteLink(
        destRegion.telegram_chat_id as number,
        {
          name: `Pathweaver-${Date.now()}`,
        }
      );
      inviteUrl = link.invite_link;
    } catch (e) {
      console.error("createChatInviteLink error:", e);
    }
  }

  // اگر راننده‌ی یک وسیله هستی، مسافرهایت را هم جابه‌جا کن
  if (char.riding_vehicle_id) {
    try {
      const { data: vehicle, error: vehErr } = await supabase
        .from("vehicles")
        .select("id, owner_char_id, title")
        .eq("id", char.riding_vehicle_id)
        .maybeSingle();

      if (!vehErr && vehicle && vehicle.owner_char_id === char.id) {
        // راننده‌ای
        const { data: passengerRows, error: passErr } = await supabase
          .from("vehicle_passengers")
          .select("character_id")
          .eq("vehicle_id", vehicle.id);

        if (!passErr && passengerRows && passengerRows.length > 0) {
          const passengerIds = passengerRows.map(
            (r: any) => r.character_id as number
          );

          const { data: passengerChars, error: pcErr } = await supabase
            .from("characters")
            .select("id, tg_id, char_name")
            .in("id", passengerIds);

          if (!pcErr && passengerChars && passengerChars.length > 0) {
            // لوکیشن و سفرشان را پایان بده
            const { error: updPassengersErr } = await supabase
              .from("characters")
              .update({
                current_region_id: destSpot.region_id,
                current_spot_id: destSpot.id,
                pending_region_id: null,
                pending_spot_id: null,
                travel_started_at: null,
                travel_ready_at: null,
                travel_total_seconds: null,
                last_move_at: now.toISOString(),
              })
              .in(
                "id",
                passengerChars.map((p: any) => p.id as number)
              );

            if (updPassengersErr) {
              console.error(
                "group arrive: update passengers error:",
                updPassengersErr
              );
            } else {
              // از گروه قبلی کیک کن
              if (prevRegion && prevRegion.telegram_chat_id) {
                for (const p of passengerChars) {
                  if (!p.tg_id) continue;
                  try {
                    await ctx.api.banChatMember(
                      prevRegion.telegram_chat_id as number,
                      p.tg_id as number,
                      { until_date: Math.floor(Date.now() / 1000) + 30 }
                    );
                    await ctx.api.unbanChatMember(
                      prevRegion.telegram_chat_id as number,
                      p.tg_id as number,
                      { only_if_banned: true }
                    );
                  } catch (e) {
                    console.warn(
                      "group arrive: kick passenger failed:",
                      e
                    );
                  }
                }
              }

              // اگر لینک داریم، برای همه‌ی مسافرها هم بفرست
              if (inviteUrl) {
                const groupKb = new InlineKeyboard().url(
                  "🚪 ورود به مکان جدید",
                  inviteUrl
                );

                for (const p of passengerChars) {
                  if (!p.tg_id) continue;
                  try {
                    await ctx.api.sendMessage(
                      p.tg_id as number,
                      `با ${char.char_name ?? "راننده"} به «${
                        destRegion?.title ?? "منطقه‌ی جدید"
                      } / ${destSpot.title}» رسیدی.\n` +
                        "برای ورود به مکان جدید، روی دکمه زیر بزن:",
                      { reply_markup: groupKb }
                    );
                  } catch (e) {
                    console.error(
                      "group arrive: notify passenger error:",
                      e
                    );
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("group arrive logic failed:", e);
    }
  }

  // پیام برای خود کاراکتر
  const kb = new InlineKeyboard();
  if (inviteUrl) {
    kb.url("🚪 ورود به مکان جدید", inviteUrl).row();
  }
  kb.text("🧭 مسیر های من", "paths:open").row().text("🏠 منوی اصلی", "ui:home");

  await sendScreen(
    ctx,
    `به «${destRegion?.title ?? "منطقه‌ی جدید"} / ${
      destSpot.title
    }» رسیدی.\n` +
      "هم‌اکنون مکان جدید در برابر تو باز شده است.",
    kb
  );
}

// --- نقشه سریع من ---

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
        "ارباب باید در یکی از گروه‌ها روی پیامت ریپلای کند و «ثبت پلیر» را بفرستد.",
      buildMainMenu()
    );
    return;
  }

  const { data: region, error: regErr } = await supabase
    .from("regions")
    .select("*")
    .eq("id", char.current_region_id)
    .maybeSingle();

  const { data: spot, error: spotErr } = await supabase
    .from("spots")
    .select("*")
    .eq("id", char.current_spot_id)
    .maybeSingle();

  if (regErr || spotErr || !region || !spot) {
    console.error("showQuickMap region/spot error:", regErr || spotErr);
    await sendScreen(
      ctx,
      "در خواندن موقعیت فعلی‌ات مشکلی پیش آمد.",
      buildMainMenu()
    );
    return;
  }

  let vehicleTitle: string | null = null;
  if (char.riding_vehicle_id) {
    const { data: vehicle, error: vehErr } = await supabase
      .from("vehicles")
      .select("id, title")
      .eq("id", char.riding_vehicle_id)
      .maybeSingle();

    if (!vehErr && vehicle) {
      vehicleTitle = vehicle.title;
    }
  }

  let text =
    `📍 موقعیت فعلی‌ات در اکلیس:\n` +
    `Region: ${region.title}\n` +
    `Spot: ${spot.title}\n`;

  if (char.clan_name) {
    text += `خاندان: ${char.clan_name}\n`;
  }

  if (vehicleTitle) {
    text += `\n🚗 وضعیت: سوار بر «${vehicleTitle}» هستی.`;
  } else {
    text += `\n🚶 وضعیت: پیاده‌ای.`;
  }

  text += `\n\nبرای دیدن مسیرهای فعلی از «🧭 مسیر های من» استفاده کن.`;

  await sendScreen(ctx, text, buildMainMenu());
}

// --- /regplayer در گروه: ثبت پلیر روی اولین Spot ---

async function handleRegPlayer(ctx: MyContext): Promise<void> {
  if (!ctx.from) return;
  if (ctx.chat?.type === "private") {
    await ctx.reply("این دستور باید داخل گروه Region استفاده شود.");
    return;
  }

  if (!ctx.chat) {
    // برای ساکت کردن TypeScript و همچنین ایمنی بیشتر
    return;
  }

  if (ctx.from.id !== MASTER_ID) {
    await ctx.reply("🥷🏻 فقط ارباب من می‌تواند از این دستور استفاده کند، حدت را بدان.");
    return;
  }

  if (!ctx.message?.reply_to_message || !ctx.message.reply_to_message.from) {
    await ctx.reply("باید روی پیام بازیکن ریپلای کنی و بعد /regplayer را بفرستی.");
    return;
  }

  const target = ctx.message.reply_to_message.from;
  const chat = ctx.chat;
  const { supabase } = ctx.services;

  // Region این گروه
  const { data: region, error: regErr } = await supabase
    .from("regions")
    .select("*")
    .eq("telegram_chat_id", chat.id)
    .maybeSingle();

    if (!ctx.chat) {
    return;
  }


  if (regErr || !region) {
    await ctx.reply("این گروه هنوز به عنوان Region ثبت نشده. اول /worldadmin را استفاده کن.");
    return;
  }

  // اولین Spot این Region
  const { data: firstSpot, error: spotErr } = await supabase
    .from("spots")
    .select("*")
    .eq("region_id", region.id)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (spotErr || !firstSpot) {
    await ctx.reply(
      "برای این Region هنوز هیچ Spotی تعریف نشده. در Supabase حداقل یک Spot بساز."
    );
    return;
  }

  // کاراکتر بازیکن
  const { data: char, error: charErr } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", target.id)
    .maybeSingle();

  let charId: number | null = null;

  if (charErr) {
    console.error("regplayer char select error:", charErr);
    await ctx.reply("در خواندن اطلاعات بازیکن مشکلی پیش آمد.");
    return;
  }

  if (char) {
    // آپدیت لوکیشن
    const { error: updErr } = await supabase
      .from("characters")
      .update({
        current_region_id: region.id,
        current_spot_id: firstSpot.id,
        pending_region_id: null,
        pending_spot_id: null,
        travel_ready_at: null,
        travel_total_seconds: null,
        travel_started_at: null,
      })
      .eq("id", char.id);
    if (updErr) {
      console.error("regplayer char update error:", updErr);
      await ctx.reply("در ثبت موقعیت بازیکن مشکلی پیش آمد.");
      return;
    }
    charId = char.id;
  } else {
    // ساخت شخصیت جدید
    const { data: ins, error: insErr } = await supabase
      .from("characters")
      .insert({
        tg_id: target.id,
        char_name: target.first_name,
        clan_name: null,
        current_region_id: region.id,
        current_spot_id: firstSpot.id,
      })
      .select("*")
      .maybeSingle();

    if (insErr || !ins) {
      console.error("regplayer char insert error:", insErr);
      await ctx.reply("در ساخت شخصیت جدید مشکلی پیش آمد.");
      return;
    }
    charId = ins.id;
  }

  await ctx.reply(
    `پلیر ثبت شد ✅\n` +
      `کاربر: ${target.first_name}\n` +
      `مکان اولیه: ${region.title} / ${firstSpot.title}`
  );
}

// --- رجیستر کردن فیچر سفر ---

export function registerTravelFeature(bot: Bot<MyContext>): void {
  // مسیرهای من
  bot.command("path", openPaths);
  bot.hears("🧭 مسیر های من", openPaths);
  bot.callbackQuery("paths:open", async (ctx) => {
    await ctx.answerCallbackQuery();
    await openPaths(ctx);
  });

  // کلیک روی مسیر پیاده
  bot.callbackQuery(/go:(\d+)/, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    const edgeId = Number(ctx.match![1]);
    await startWalkTravel(ctx, edgeId);
  });

  // رسیدم؟
  bot.command("arrive", handleArrive);
  bot.callbackQuery("travel:arrive", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleArrive(ctx);
  });

  // نقشه سریع من
  bot.command("mymap", showQuickMap);
  bot.hears("🗺 نقشه سریع من", showQuickMap);
  bot.callbackQuery("mymap:open", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showQuickMap(ctx);
  });

  // ثبت پلیر در Region
  bot.command("regplayer", handleRegPlayer);
}
