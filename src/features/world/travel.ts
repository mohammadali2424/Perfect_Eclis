
import { Bot, InlineKeyboard } from "grammy";
import { MyContext, CharacterState } from "../../core/types";

async function getCharacter(ctx: MyContext): Promise<CharacterState | null> {
  const { supabase } = ctx.services;
  if (!ctx.from) return null;

  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .eq("tg_id", ctx.from.id)
    .maybeSingle();

  if (error || !data) return null;
  return data as CharacterState;
}

async function getCurrentPlace(
  ctx: MyContext,
  ch: CharacterState
): Promise<{ region: any | null; spot: any | null }> {
  const { supabase } = ctx.services;

  let region: any = null;
  let spot: any = null;

  if (ch.current_region_id) {
    const { data: r } = await supabase
      .from("regions")
      .select("*")
      .eq("id", ch.current_region_id)
      .maybeSingle();
    region = r;
  }

  if (ch.current_spot_id != null) {
    const { data: s } = await supabase
      .from("spots")
      .select("*")
      .eq("id", ch.current_spot_id)
      .maybeSingle();
    spot = s;
  }

  return { region, spot };
}

export function registerTravelFeature(bot: Bot<MyContext>) {
  bot.command("path", async (ctx) => {
    if (!ctx.from) return;

    const ch = await getCharacter(ctx);
    if (!ch) {
      await ctx.reply(
        "شخصیتت در جهان اکلیس ثبت نشده.\nاز ارباب بخواه با /regplayer تو را ثبت کند."
      );
      return;
    }

    const now = new Date();
    if (ch.travel_ready_at) {
      const ready = new Date(ch.travel_ready_at);
      if (ready > now) {
        const diffMs = ready.getTime() - now.getTime();
        const diffMin = Math.ceil(diffMs / 60000);
        await ctx.reply(
          `هنوز در حال سفر هستی.\nتقریباً ${diffMin} دقیقه دیگر به مقصد می‌رسی.`
        );
        return;
      }
    }

    const { region, spot } = await getCurrentPlace(ctx, ch);

    if (!region || !spot) {
      await ctx.reply(
        "مکان فعلی‌ات نامشخص است. از ارباب بخواه تو را روی یک Spot قرار دهد."
      );
      return;
    }

    const { supabase } = ctx.services;

    const { data: edges, error } = await supabase
      .from("edges")
      .select("id,travel_seconds,to_spot_id,spots!edges_to_spot_id_fkey(title)")
      .eq("from_spot_id", ch.current_spot_id);

    if (error) {
      console.error("edges select error:", error);
      await ctx.reply("در خواندن مسیرها خطایی رخ داد.");
      return;
    }

    const list = edges || [];

    if (list.length === 0) {
      await ctx.reply(
        `مکان فعلی:\n${region.title} / ${spot.title}\n\nاز این نقطه هیچ مسیری تعریف نشده.\nارباب باید از /worldadmin برای ساخت مسیر استفاده کند.`
      );
      return;
    }

    const kb = new InlineKeyboard();
    for (const e of list as any[]) {
      const toTitle = e.spots?.title ?? `Spot #${e.to_spot_id}`;
      const minutes = Math.max(1, Math.round(e.travel_seconds / 60));
      const label = `${toTitle} (${minutes} دقیقه)`;
      kb.text(label, `travel:edge:${e.id}`).row();
    }

    await ctx.reply(
      [
        `مکان فعلی:\n<b>${region.title}</b> / <b>${spot.title}</b>`,
        "",
        "می‌توانی به این مسیرها سفر کنی:",
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: kb,
      }
    );
  });

  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery?.data || "";
    if (!data.startsWith("travel:")) {
      await next();
      return;
    }

    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }

    const parts = data.split(":");
    if (parts.length !== 3 || parts[1] !== "edge") {
      await ctx.answerCallbackQuery();
      return;
    }

    const edgeId = Number(parts[2]);
    if (!Number.isFinite(edgeId)) {
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.answerCallbackQuery();

    const ch = await getCharacter(ctx);
    if (!ch) {
      await ctx.reply(
        "شخصیتت در جهان اکلیس ثبت نشده.\nاز ارباب بخواه با /regplayer تو را ثبت کند."
      );
      return;
    }

    const now = new Date();
    if (ch.travel_ready_at) {
      const ready = new Date(ch.travel_ready_at);
      if (ready > now) {
        const diffMs = ready.getTime() - now.getTime();
        const diffMin = Math.ceil(diffMs / 60000);
        await ctx.reply(
          `هنوز در حال سفر قبلی هستی.\nحدود ${diffMin} دقیقه تا رسیدن باقی مانده.`
        );
        return;
      }
    }

    const { supabase } = ctx.services;

    const { data: edge, error } = await supabase
      .from("edges")
      .select("id,from_spot_id,to_spot_id,travel_seconds,spots!edges_to_spot_id_fkey(*),regions!edges_to_spot_id_fkey(*)")
      .eq("id", edgeId)
      .maybeSingle();

    if (error || !edge) {
      await ctx.reply("این مسیر دیگر وجود ندارد.");
      return;
    }

    const travelSeconds = (edge as any).travel_seconds as number;
    const toSpotId = (edge as any).to_spot_id as number;

    const readyAt = new Date(now.getTime() + travelSeconds * 1000);

    const { error: updErr } = await supabase
      .from("characters")
      .update({
        last_move_at: now.toISOString(),
        travel_ready_at: readyAt.toISOString(),
        current_spot_id: toSpotId,
      })
      .eq("id", ch.id);

    if (updErr) {
      console.error("update character travel error:", updErr);
      await ctx.reply("در ثبت سفر خطایی رخ داد.");
      return;
    }

    const minutes = Math.max(1, Math.round(travelSeconds / 60));
    await ctx.reply(
      `سفر آغاز شد.\nحدود ${minutes} دقیقه طول می‌کشد تا به مقصد برسی.`
    );
  });
}
