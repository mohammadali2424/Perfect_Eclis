// src/features/economy/flux-well.ts
import { Bot, InlineKeyboard } from "grammy";
import type { MyContext } from "../../core/types";

type WellKind = "normal" | "emergency";

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function getBankChatId(ctx: MyContext): Promise<number | null> {
  const { supabase } = ctx.services;
  const { data, error } = await supabase
    .from("bank_settings")
    .select("bank_chat_id")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("getBankChatId error:", error);
    return null;
  }
  return data?.bank_chat_id ?? null;
}

async function getFluxPricePerPercent(ctx: MyContext): Promise<number | null> {
  const { supabase } = ctx.services;
  const { data, error } = await supabase
    .from("economy_settings")
    .select("value_json")
    .eq("key", "flux_base_price")
    .maybeSingle();

  if (error) {
    console.error("getFluxPricePerPercent error:", error);
    return null;
  }

  const v = Number(data?.value_json?.per_percent);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// ✅ در پروژه تو: چاه فعال یعنی رکورد وجود دارد (نه enabled)
async function hasWell(ctx: MyContext, spotId: number, kind: WellKind = "normal"): Promise<boolean> {
  const { supabase } = ctx.services;
  // اگر هنوز ستون kind نداری، اینجا kind را حذف کن و فقط spot_id/region_id را چک کن
  const { data, error } = await supabase
    .from("flux_wells")
    .select("spot_id")
    .eq("spot_id", spotId)
    .eq("kind", kind)
    .maybeSingle();

  if (error) {
    // اگر ستون kind نداری، احتمالاً اینجا خطای 42703 می‌گیری
    console.error("hasWell error:", error);
    return false;
  }
  return !!data;
}

async function getCharAndVehicle(ctx: MyContext) {
  const { supabase } = ctx.services;

  const { data: char, error: charErr } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", ctx.from!.id)
    .maybeSingle();

  if (charErr || !char) return { char: null as any, vehicle: null as any };

  if (!char.riding_vehicle_id) return { char, vehicle: null as any };

  const { data: vehicle, error: vehErr } = await supabase
    .from("vehicles")
    .select("id, owner_char_id, title, fuel_percent, current_spot_id, current_region_id")
    .eq("id", char.riding_vehicle_id)
    .maybeSingle();

  if (vehErr || !vehicle) return { char, vehicle: null as any };

  // ✅ مثل منطق خودت: فقط اگر راننده/مالک است
  if (vehicle.owner_char_id !== char.id) return { char, vehicle: null as any };

  return { char, vehicle };
}

// --- Station state (صف ۲ نفره) ---

async function ensureStationRow(supabase: any, spotId: number) {
  await supabase
    .from("flux_station_state")
    .upsert({ spot_id: spotId, updated_at: new Date().toISOString() }, { onConflict: "spot_id" });
}

async function enterStation(supabase: any, spotId: number, userTgId: number) {
  await ensureStationRow(supabase, spotId);

  const { data, error } = await supabase
    .from("flux_station_state")
    .select("*")
    .eq("spot_id", spotId)
    .maybeSingle();

  if (error || !data) throw error ?? new Error("station_state not found");

  const active: number[] = Array.isArray(data.active_user_tg_ids) ? data.active_user_tg_ids : [];
  const queue: number[] = Array.isArray(data.queue_user_tg_ids) ? data.queue_user_tg_ids : [];

  if (active.includes(userTgId)) return { status: "ACTIVE" as const, active, queue };
  if (queue.includes(userTgId)) return { status: "QUEUED" as const, active, queue };

  if (active.length < 2) {
    active.push(userTgId);
    const { error: updErr } = await supabase
      .from("flux_station_state")
      .update({ active_user_tg_ids: active, updated_at: new Date().toISOString() })
      .eq("spot_id", spotId);

    if (updErr) throw updErr;
    return { status: "ACTIVE" as const, active, queue };
  }

  queue.push(userTgId);
  const { error: updErr } = await supabase
    .from("flux_station_state")
    .update({ queue_user_tg_ids: queue, updated_at: new Date().toISOString() })
    .eq("spot_id", spotId);

  if (updErr) throw updErr;
  return { status: "QUEUED" as const, active, queue };
}

async function leaveStation(supabase: any, spotId: number, userTgId: number) {
  const { data, error } = await supabase
    .from("flux_station_state")
    .select("*")
    .eq("spot_id", spotId)
    .maybeSingle();

  if (error || !data) return { nextUser: null as number | null };

  let active: number[] = Array.isArray(data.active_user_tg_ids) ? data.active_user_tg_ids : [];
  let queue: number[] = Array.isArray(data.queue_user_tg_ids) ? data.queue_user_tg_ids : [];

  active = active.filter((x) => x !== userTgId);

  let nextUser: number | null = null;
  if (active.length < 2 && queue.length > 0) {
    nextUser = queue[0];
    queue = queue.slice(1);
    active.push(nextUser);
  }

  const { error: updErr } = await supabase
    .from("flux_station_state")
    .update({
      active_user_tg_ids: active,
      queue_user_tg_ids: queue,
      updated_at: new Date().toISOString(),
    })
    .eq("spot_id", spotId);

  if (updErr) console.error("leaveStation update error:", updErr);

  return { nextUser };
}

// --- Refuel sessions ---

async function createOrReplaceSession(
  ctx: MyContext,
  spotId: number,
  userTgId: number,
  charId: number,
  vehicleId: number,
  currentFuel: number,
  targetFuel: number
) {
  const { supabase } = ctx.services;

  const perPercent = await getFluxPricePerPercent(ctx);
  if (!perPercent) {
    throw new Error("Flux price is not set (economy_settings: flux_base_price)");
  }

  const delta = Math.max(0, targetFuel - currentFuel);
  const price = Math.max(0, Math.round(delta * perPercent));

  // پاک کردن سشن‌های قبلیِ باز برای همین کاربر (MVP)
  await supabase
    .from("flux_refuel_sessions")
    .delete()
    .eq("user_tg_id", userTgId)
    .neq("status", "PAID");

  const { data, error } = await supabase
    .from("flux_refuel_sessions")
    .insert({
      spot_id: spotId,
      user_tg_id: userTgId,
      char_id: charId,
      vehicle_id: vehicleId,
      current_fuel: currentFuel,
      target_fuel: targetFuel,
      delta_fuel: delta,
      price,
      status: "CONFIRM",
    })
    .select("*")
    .maybeSingle();

  if (error || !data) throw error ?? new Error("create session failed");
  return data;
}

async function paySession(ctx: MyContext, sessionId: string) {
  const { supabase } = ctx.services;

  const { data: s, error } = await supabase
    .from("flux_refuel_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !s) {
    await ctx.reply("سشن سوخت‌گیری پیدا نشد.");
    return;
  }

  if (s.status === "PAID") {
    await ctx.reply("این سشن قبلاً پرداخت شده.");
    return;
  }

  // آپدیت سوخت ماشین
  const { error: vehErr } = await supabase
    .from("vehicles")
    .update({ fuel_percent: s.target_fuel })
    .eq("id", s.vehicle_id);

  if (vehErr) {
    console.error("paySession vehicle update error:", vehErr);
    await ctx.reply("در ثبت سوخت مشکلی پیش آمد.");
    return;
  }

  // سشن را پرداخت‌شده کن
  await supabase
    .from("flux_refuel_sessions")
    .update({ status: "PAID" })
    .eq("id", s.id);

  // ✅ ارسال به بانکِ ثبت‌شده دستی
  const bankChatId = await getBankChatId(ctx);
  if (bankChatId) {
    try {
      await ctx.api.sendMessage(
        bankChatId,
        "🏦 تراکنش سوخت‌گیری فلوکس\n" +
          `👤 کاربر: ${ctx.from?.id}\n` +
          `📍 spot_id: ${s.spot_id}\n` +
          `🚗 vehicle_id: ${s.vehicle_id}\n` +
          `⛽ افزودن: ${Number(s.delta_fuel).toFixed(1)}٪\n` +
          `🎯 هدف: ${s.target_fuel}٪\n` +
          `💰 هزینه: ${s.price} Solen\n` +
          `🧾 session: ${s.id}`
      );
    } catch (e) {
      console.error("send bank tx failed:", e);
    }
  }

  await ctx.reply(
    `✅ سوخت‌گیری انجام شد.\n` +
      `سوخت ماشینت شد: ${s.target_fuel}٪\n` +
      `هزینه: ${s.price} Solen`
  );

  // آزاد کردن جایگاه و بردن نفر بعدی
  const { nextUser } = await leaveStation(supabase, s.spot_id, s.user_tg_id);
  if (nextUser) {
    try {
      await ctx.api.sendMessage(
        nextUser,
        `نوبتت رسید ✅\nبرای سوخت‌گیری دوباره روی «سوخت‌گیری» بزن.`
      );
    } catch {}
  }
}

export function registerFluxWellFeature(bot: Bot<MyContext>) {
  // شروع سوخت‌گیری
  bot.callbackQuery("flux:refuel", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const { char, vehicle } = await getCharAndVehicle(ctx as any);
    if (!char || !vehicle) {
      await ctx.reply("برای سوخت‌گیری باید راننده‌ی ماشین خودت باشی.");
      return;
    }

    const spotId = Number(char.current_spot_id ?? 0);
    if (!spotId) {
      await ctx.reply("مکان فعلی مشخص نیست.");
      return;
    }

    // ✅ چاه فعال یعنی رکورد normal وجود دارد
    const ok = await hasWell(ctx as any, spotId, "normal");
    if (!ok) {
      await ctx.reply("اینجا چاه فلوکس فعال نیست.");
      return;
    }

    const state = await enterStation(ctx.services.supabase, spotId, ctx.from.id);

    if (state.status === "QUEUED") {
      await ctx.reply("⏳ جایگاه پر است. وارد صف شدی.");
      return;
    }

    const kb = new InlineKeyboard()
      .text("50٪", "flux:refuel:set:50")
      .text("75٪", "flux:refuel:set:75")
      .row()
      .text("100٪", "flux:refuel:set:100")
      .row()
      .text("❌ انصراف", "flux:refuel:cancel");

    await ctx.reply(
      `⛽ سوخت فعلی ماشینت: ${Number(vehicle.fuel_percent ?? 0).toFixed(1)}٪\n` +
        `تا چند درصد پر کنم؟`,
      { reply_markup: kb }
    );
  });

  // انتخاب درصد هدف
  bot.callbackQuery(/^flux:refuel:set:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const target = clampInt(Number(ctx.match[1]), 0, 100);

    const { char, vehicle } = await getCharAndVehicle(ctx as any);
    if (!char || !vehicle) {
      await ctx.reply("برای سوخت‌گیری باید راننده‌ی ماشین خودت باشی.");
      return;
    }

    const spotId = Number(char.current_spot_id ?? 0);
    const ok = await hasWell(ctx as any, spotId, "normal");
    if (!ok) {
      await ctx.reply("اینجا چاه فلوکس فعال نیست.");
      return;
    }

    const currentFuel = Number(vehicle.fuel_percent ?? 0);
    if (target <= currentFuel) {
      await ctx.reply("سوختت همین الان هم از این مقدار بیشتر یا برابر است. عدد بالاتر بزن.");
      return;
    }

    let session: any;
    try {
      session = await createOrReplaceSession(
        ctx as any,
        spotId,
        ctx.from.id,
        char.id,
        vehicle.id,
        currentFuel,
        target
      );
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("Flux price is not set")) {
        await ctx.reply("قیمت فلوکس هنوز تنظیم نشده. ارباب باید «ثبت سراسری قیمت فلوکس» را انجام دهد.");
        return;
      }
      console.error("create session error:", e);
      await ctx.reply("در ساخت سشن سوخت‌گیری مشکلی پیش آمد.");
      return;
    }

    const kb = new InlineKeyboard()
      .text("✅ تایید", `flux:refuel:confirm:${session.id}`)
      .row()
      .text("❌ انصراف", "flux:refuel:cancel");

    await ctx.reply(
      `🧾 تایید سوخت‌گیری\n` +
        `سوخت فعلی: ${currentFuel.toFixed(1)}٪\n` +
        `هدف: ${target}٪\n` +
        `افزودن: ${Number(session.delta_fuel).toFixed(1)}٪\n` +
        `هزینه: ${session.price} Solen\n\n` +
        `مطمئنی؟`,
      { reply_markup: kb }
    );
  });

  // تایید
  bot.callbackQuery(/^flux:refuel:confirm:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await paySession(ctx as any, ctx.match[1]);
  });

  // انصراف
  bot.callbackQuery("flux:refuel:cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const { supabase } = (ctx as any).services;

    // سشن باز این کاربر رو حذف کن
    await supabase
      .from("flux_refuel_sessions")
      .delete()
      .eq("user_tg_id", ctx.from.id)
      .neq("status", "PAID");

    // از صف/active هم خارجش کن (اگر spot رو داریم)
    const { data: char } = await supabase
      .from("characters")
      .select("current_spot_id")
      .eq("tg_id", ctx.from.id)
      .maybeSingle();

    if (char?.current_spot_id) {
      await leaveStation(supabase, Number(char.current_spot_id), ctx.from.id);
    }

    await ctx.reply("لغو شد.");
  });
}
