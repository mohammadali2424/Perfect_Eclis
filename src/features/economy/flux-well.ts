// src/features/economy/flux-well.ts
import { Bot, InlineKeyboard } from "grammy";
import type { MyContext } from "../../core/types";
import { BANK_GROUP_ID, FLUX_PRICE_PER_PERCENT } from "../../core/config"; // اگر نداری، پایین می‌گم چطور بسازی

type Kind = "normal" | "emergency";

async function isWellEnabled(supabase: any, spotId: number, kind: Kind): Promise<boolean> {
  const { data, error } = await supabase
    .from("flux_wells")
    .select("enabled")
    .eq("spot_id", spotId)
    .eq("kind", kind)
    .maybeSingle();

  if (error) {
    console.error("isWellEnabled error:", error);
    return false;
  }
  return Boolean(data?.enabled);
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function calcPrice(deltaPercent: number) {
  return Math.max(0, Math.round(deltaPercent * FLUX_PRICE_PER_PERCENT));
}

async function getCharAndVehicle(ctx: MyContext) {
  const { supabase } = ctx.services;

  const { data: char, error: charErr } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", ctx.from!.id)
    .maybeSingle();

  if (charErr || !char) return { char: null, vehicle: null };

  if (!char.riding_vehicle_id) return { char, vehicle: null };

  const { data: vehicle, error: vehErr } = await supabase
    .from("vehicles")
    .select("id, owner_char_id, title, fuel_percent, current_spot_id, current_region_id")
    .eq("id", char.riding_vehicle_id)
    .maybeSingle();

  if (vehErr || !vehicle) return { char, vehicle: null };

  // فقط اگر راننده/مالک است اجازه بده (با منطق تو هماهنگه)
  if (vehicle.owner_char_id !== char.id) return { char, vehicle: null };

  return { char, vehicle };
}

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

  // اگر قبلاً داخل active یا صفه، همون وضعیت
  if (active.includes(userTgId)) return { status: "ACTIVE" as const, active, queue };
  if (queue.includes(userTgId)) return { status: "QUEUED" as const, active, queue };

  if (active.length < 2) {
    active.push(userTgId);
    const { error: updErr } = await supabase.from("flux_station_state").update({
      active_user_tg_ids: active,
      updated_at: new Date().toISOString(),
    }).eq("spot_id", spotId);
    if (updErr) throw updErr;
    return { status: "ACTIVE" as const, active, queue };
  } else {
    queue.push(userTgId);
    const { error: updErr } = await supabase.from("flux_station_state").update({
      queue_user_tg_ids: queue,
      updated_at: new Date().toISOString(),
    }).eq("spot_id", spotId);
    if (updErr) throw updErr;
    return { status: "QUEUED" as const, active, queue };
  }
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

  const { error: updErr } = await supabase.from("flux_station_state").update({
    active_user_tg_ids: active,
    queue_user_tg_ids: queue,
    updated_at: new Date().toISOString(),
  }).eq("spot_id", spotId);

  if (updErr) console.error("leaveStation update error:", updErr);

  return { nextUser };
}

async function createOrReplaceSession(supabase: any, spotId: number, userTgId: number, charId: number, vehicleId: number, currentFuel: number, targetFuel: number) {
  const delta = Math.max(0, targetFuel - currentFuel);
  const price = calcPrice(delta);

  // پاک کردن سشن‌های قبلی باز (MVP)
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

  // سوخت ماشین را آپدیت کن
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

  // پیام بانک (اگر تنظیم شده)
  if (BANK_GROUP_ID) {
    try {
      await ctx.api.sendMessage(
        BANK_GROUP_ID,
        `🏦 تراکنش سوخت‌گیری فلوکس\n` +
          `👤 کاربر: ${ctx.from?.id}\n` +
          `📍 Spot: ${s.spot_id}\n` +
          `🚗 Vehicle: ${s.vehicle_id}\n` +
          `⛽ افزودن: ${Number(s.delta_fuel).toFixed(1)}٪\n` +
          `💰 هزینه: ${s.price}\n` +
          `🧾 Session: ${s.id}`
      );
    } catch (e) {
      console.error("send bank tx failed:", e);
    }
  }

  await ctx.reply(
    `✅ سوخت‌گیری انجام شد.\n` +
      `سوخت ماشینت شد: ${s.target_fuel}٪\n` +
      `هزینه: ${s.price}`
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

    const enabled = await isWellEnabled(ctx.services.supabase, spotId, "normal");
    if (!enabled) {
      await ctx.reply("اینجا چاه فلوکس فعال نیست.");
      return;
    }

    const state = await enterStation(ctx.services.supabase, spotId, ctx.from.id);

    if (state.status === "QUEUED") {
      await ctx.reply("⏳ جایگاه پر است. وارد صف شدی.");
      return;
    }

    // ACTIVE: از کاربر بپرس تا چند درصد پر کنم؟
    const kb = new InlineKeyboard()
      .text("50٪", "flux:refuel:set:50").text("75٪", "flux:refuel:set:75").row()
      .text("100٪", "flux:refuel:set:100").row()
      .text("انصراف", "flux:refuel:cancel");

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
    const enabled = await isWellEnabled(ctx.services.supabase, spotId, "normal");
    if (!enabled) {
      await ctx.reply("اینجا چاه فلوکس فعال نیست.");
      return;
    }

    const currentFuel = Number(vehicle.fuel_percent ?? 0);
    const session = await createOrReplaceSession(
      ctx.services.supabase,
      spotId,
      ctx.from.id,
      char.id,
      vehicle.id,
      currentFuel,
      target
    );

    const kb = new InlineKeyboard()
      .text("✅ تایید و پرداخت", `flux:refuel:confirm:${session.id}`).row()
      .text("❌ انصراف", "flux:refuel:cancel");

    await ctx.reply(
      `🧾 تایید سوخت‌گیری\n` +
        `سوخت فعلی: ${currentFuel.toFixed(1)}٪\n` +
        `هدف: ${target}٪\n` +
        `افزودن: ${Number(session.delta_fuel).toFixed(1)}٪\n` +
        `هزینه: ${session.price}\n\n` +
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

    // اگر می‌خوای از active/queue هم حذفش کنیم:
    const { supabase } = (ctx as any).services;
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
