// src/features/economy/fuel-admin.ts
import { Bot, InlineKeyboard } from "grammy";
import type { MyContext } from "../../core/types";

type Kind = "normal" | "emergency";

function kindTitle(kind: Kind) {
  return kind === "normal" ? "چاه فلوکس" : "چاه اضطراری فلوکس";
}

async function getWellEnabled(supabase: any, spotId: number, kind: Kind): Promise<boolean> {
  const { data, error } = await supabase
    .from("flux_wells")
    .select("enabled")
    .eq("spot_id", spotId)
    .eq("kind", kind)
    .maybeSingle();

  if (error) {
    console.error("getWellEnabled error:", error);
    return false;
  }
  return Boolean(data?.enabled);
}

async function toggleWell(supabase: any, spotId: number, kind: Kind): Promise<boolean> {
  const current = await getWellEnabled(supabase, spotId, kind);
  const next = !current;

  const { error } = await supabase
    .from("flux_wells")
    .upsert(
      {
        spot_id: spotId,
        kind,
        enabled: next,
      },
      { onConflict: "spot_id,kind" }
    );

  if (error) {
    console.error("toggleWell upsert error:", error);
    return current; // اگر خطا خورد، همون قبلی رو برگردون
  }

  return next;
}

async function buildSpotsKeyboard(ctx: MyContext, kind: Kind) {
  const { supabase } = ctx.services;

  // اگر جدول spots فیلد region_id/title داره، همین خوبه
  const { data: spots, error } = await supabase
    .from("spots")
    .select("id, title, region_id")
    .order("region_id", { ascending: true })
    .order("id", { ascending: true });

  if (error || !spots) {
    console.error("load spots error:", error);
    return new InlineKeyboard().text("🔄 تلاش دوباره", `flux:open:${kind}`);
  }

  const kb = new InlineKeyboard();

  // برای اینکه درخواست DB زیاد نشه، وضعیت‌ها رو یکجا بگیر:
  const spotIds = spots.map((s: any) => s.id);
  const { data: wells } = await supabase
    .from("flux_wells")
    .select("spot_id, kind, enabled")
    .in("spot_id", spotIds)
    .eq("kind", kind);

  const enabledMap = new Map<number, boolean>();
  for (const w of wells ?? []) enabledMap.set(w.spot_id, Boolean(w.enabled));

  for (const s of spots) {
    const enabled = enabledMap.get(s.id) ?? false;
    const mark = enabled ? "✅" : "❌";
    kb.text(`${mark} ${s.title}`, `flux:set:${s.id}:${kind}`).row();
  }

  kb.text("🏠 منوی اصلی", "ui:home");
  return kb;
}

export function registerFuelAdminFeature(bot: Bot<MyContext>) {
  // ادمین‌چک اگر داری، اینجا بذار. فعلاً همون حالت ساده:
  bot.hears("ساخت چاه فلوکس", async (ctx) => {
    if (!ctx.from) return;

    // پیام گروه پاک شود
    if (ctx.chat?.type !== "private") {
      try {
        await ctx.deleteMessage();
      } catch {}
    }

    // برو پیوی
    await ctx.api.sendMessage(
      ctx.from.id,
      `🛠 پنل ساخت ${kindTitle("normal")}\n` +
        "روی هر منطقه/اسپات بزن تا فعال/غیرفعال شود:",
      { reply_markup: await buildSpotsKeyboard(ctx as any, "normal") }
    );
  });

  bot.hears("ساخت چاه اضطراری فلوکس", async (ctx) => {
    if (!ctx.from) return;

    if (ctx.chat?.type !== "private") {
      try {
        await ctx.deleteMessage();
      } catch {}
    }

    await ctx.api.sendMessage(
      ctx.from.id,
      `🛠 پنل ساخت ${kindTitle("emergency")}\n` +
        "روی هر منطقه/اسپات بزن تا فعال/غیرفعال شود:",
      { reply_markup: await buildSpotsKeyboard(ctx as any, "emergency") }
    );
  });

  // (اختیاری) برای دکمه‌ی تلاش دوباره
  bot.callbackQuery(/^flux:open:(normal|emergency)$/, async (ctx) => {
    const kind = ctx.match[1] as Kind;
    await ctx.editMessageReplyMarkup({
      reply_markup: await buildSpotsKeyboard(ctx as any, kind),
    });
    await ctx.answerCallbackQuery();
  });

  // ✅ این همون چیزیه که پنلت کم داشت: toggle واقعی
  bot.callbackQuery(/^flux:set:(\d+):(normal|emergency)$/, async (ctx) => {
    const spotId = Number(ctx.match[1]);
    const kind = ctx.match[2] as Kind;

    const { supabase } = (ctx as any).services;

    // toggle در DB
    const enabledNow = await toggleWell(supabase, spotId, kind);

    // آپدیت کیبورد همان پیام
    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: await buildSpotsKeyboard(ctx as any, kind),
      });
    } catch (e) {
      // اگر پیام قدیمی بود یا قابل ادیت نبود، مهم نیست
      console.warn("editMessageReplyMarkup failed:", e);
    }

    await ctx.answerCallbackQuery(
      enabledNow ? `✅ ${kindTitle(kind)} فعال شد` : `❌ ${kindTitle(kind)} غیرفعال شد`,
    );
  });
}
