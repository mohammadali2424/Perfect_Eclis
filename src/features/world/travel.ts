async function showQuickMap(ctx: MyContext) {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("نقشه‌ی درونی فقط در پی‌وی من باز می‌شود.");
    return;
  }

  const { supabase } = ctx.services;
  const char = await ensureCharacter(ctx);

  if (!char.current_spot_id || !char.current_region_id) {
    await ctx.reply(
      "هنوز مکان مشخصی برایت ثبت نشده.\n" +
        "ارباب باید ابتدا تو را در یکی از مناطق با /regplayer ثبت کند."
    );
    return;
  }

  const { data: spot, error: spotErr } = await supabase
    .from("spots")
    .select("id,title,region_id")
    .eq("id", char.current_spot_id)
    .single();

  if (spotErr || !spot) {
    await ctx.reply("نقشه نتوانست نقطه‌ی فعلی‌ات را پیدا کند.");
    return;
  }

  const { data: region, error: regErr } = await supabase
    .from("regions")
    .select("id,title")
    .eq("id", spot.region_id)
    .single();

  if (regErr || !region) {
    await ctx.reply("نقشه نتوانست قلمروی فعلی‌ات را پیدا کند.");
    return;
  }

  const clan = char.clan_name as string | null;

  const text =
    "🗺 نقشه‌ی درونی فعال شد…\n\n" +
    (clan ? `🧬 خون تو: ${clan}\n\n` : "") +
    `🏰 قلمرو: ${region.title}\n` +
    `⬙ نقطه: ${spot.title}\n\n` +
    "خطوط نامرئی مسیرها در ذهن تو روشن می‌شوند.\n" +
    "برای دیدن راه‌های قابل پیمایش، از «🧭 مسیر های من» استفاده کن.";

  await ctx.reply(text);
}
