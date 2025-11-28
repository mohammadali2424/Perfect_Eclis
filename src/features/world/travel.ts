import type { EclisContext } from "../../core/bot.js";
import { supabase } from "../../core/supabase.js";
import type { MovementMode, WorldEdge, WorldSpot } from "../../core/types.js";

// لوکیشن فعلی کاراکتر
async function getCharacterLocation(userId: number) {
  const { data, error } = await supabase
    .from("characters")
    .select("region_id, spot_id")
    .eq("telegram_id", userId)
    .single();

  if (error || !data) return null;
  return data as { region_id: string; spot_id: string };
}

// گرفتن اطلاعات Spot
async function getSpot(spotId: string): Promise<WorldSpot | null> {
  const { data, error } = await supabase
    .from("world_spots")
    .select("*")
    .eq("id", spotId)
    .single();

  if (error || !data) return null;
  return data as WorldSpot;
}

// گرفتن Edgeهای مجاز برای Mode فعلی
async function getEdgesForSpotAndMode(
  spotId: string,
  mode: MovementMode,
): Promise<WorldEdge[]> {
  let column = "can_walk";
  if (mode === "ride") column = "can_ride";
  else if (mode === "drive") column = "can_drive";
  else if (mode === "transport") column = "can_transport";

  const { data, error } = await supabase
    .from("world_edges")
    .select("*")
    .eq("from_spot_id", spotId)
    .eq(column, true);

  if (error || !data) return [];
  return data as WorldEdge[];
}

// نمایش «مسیرهای من»
export async function handleMyPaths(ctx: EclisContext) {
  if (!ctx.from) return;

  const loc = await getCharacterLocation(ctx.from.id);
  if (!loc) {
    return ctx.reply(
      "هنوز برای شخصیتت موقعیت ثبت نشده.\n" +
        "ارباب باید تو را در یک Spot اولیه قرار بدهد.",
    );
  }

  const mode = ctx.session.movementMode ?? "walk";
  const edges = await getEdgesForSpotAndMode(loc.spot_id, mode);
  const spot = await getSpot(loc.spot_id);
  const placeTitle = spot ? spot.title : "مکان ناشناس";

  if (!edges.length) {
    return ctx.reply(
      `مکان فعلی:\n${placeTitle}\n\n` +
        `برای حالت فعلی (${mode}) هیچ مسیری ثبت نشده.`,
    );
  }

  let txt = `مکان فعلی:\n${placeTitle}\n\n`;
  txt += "مسیرهای در دسترس:\n";

  for (const e of edges) {
    const toSpot = await getSpot(e.to_spot_id);
    const name = toSpot ? toSpot.title : e.to_spot_id;
    txt += `\n• به «${name}» — زمان پایه: ${e.base_travel_seconds} ثانیه`;
  }

  txt +=
    "\n\nدر نسخهٔ فعلی فقط نمایش متنی داریم؛ " +
    "در مرحلهٔ بعد، دکمه‌های اینلاین و حرکت واقعی زمان‌دار را اضافه می‌کنیم.";

  await ctx.reply(txt);
}
