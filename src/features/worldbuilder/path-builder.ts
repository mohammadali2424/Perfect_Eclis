import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";

const MASTER_ID = Number(process.env.MASTER_ID || 0);

type PathWizardStep =
  | "idle"
  | "chooseTargetRegion"
  | "chooseFromSpot"
  | "chooseToSpot"
  | "askTime"
  | "chooseDirection"
  | "chooseModes";

type DirectionMode = "forward" | "backward" | "both";

interface PathWizardState {
  mode: "create";
  step: PathWizardStep;
  fromChatId: number;      // گروهی که توش «ساخت مسیر» زده شد
  fromRegionId: number;    // Region آن گروه
  targetRegionId?: number; // Region مقصد
  fromSpotId?: number;
  toSpotId?: number;
  travelSeconds?: number;
  driveSeconds?: number;
  direction?: DirectionMode;
  allowWalk: boolean;
  allowDrive: boolean;
  allowTransport: boolean;
  blockMount: boolean;
}

/**
 * دسترسی راحت به state در session
 */
function getWizard(ctx: MyContext): PathWizardState | null {
  const s: any = (ctx as any).session;
  return s?.pathWizard ?? null;
}

function setWizard(ctx: MyContext, state: PathWizardState | null) {
  const s: any = (ctx as any).session;
  if (!s) return;
  s.pathWizard = state;
}

/**
 * فقط ارباب
 */
function isMaster(ctx: MyContext): boolean {
  return !!ctx.from && ctx.from.id === MASTER_ID;
}

/**
 * منوی اصلی پی‌وی بازیکن (همون قبلی‌ها)
 */
function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text("🧭 مسیر های من", "paths:open")
    .row()
    .text("🗺 نقشه سریع من", "map:me")
    .row()
    .text("🚗 ماشین های من", "veh:menu");
}

/**
 * ساخت کیبورد انتخاب نوع حرکت‌ها
 */
function buildModesKeyboard(state: PathWizardState) {
  const kb = new InlineKeyboard();

  kb
    .text(`پیاده ${state.allowWalk ? "✅" : "❌"}`, "pb:mode:walk")
    .row()
    .text(`راننده ${state.allowDrive ? "✅" : "❌"}`, "pb:mode:drive")
    .row()
    .text(
      `حمل و نقل ${state.allowTransport ? "✅" : "❌"}`,
      "pb:mode:transport"
    )
    .row()
    .text(
      `بلاک مونت ${state.blockMount ? "✅" : "❌"}`,
      "pb:mode:blockmount"
    )
    .row()
    .text("✅ ثبت مسیر و پایان", "pb:save:once")
    .row()
    .text("🔁 ثبت و ساخت مسیر بعدی", "pb:save:again")
    .row()
    .text("❌ لغو", "pb:cancel");

  return kb;
}

/**
 * فیچر ساخت مسیر (Edge) با ویزارد
 */
export function registerPathBuilderFeature(bot: Bot<MyContext>): void {
  //
  // ۱) دستور «ساخت مسیر» در گروه
  //
  bot.hears("ساخت مسیر", async (ctx) => {
    if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) {
      return;
    }

    // فقط ارباب
    if (!isMaster(ctx)) {
      await ctx.reply("🥷🏻 فقط ارباب من می‌تواند به پنل ساخت مسیر دسترسی داشته باشد. حدت را بدان.");
      return;
    }

    const { supabase } = ctx.services;

    // سعی کن پیام دستور را پاک کنی
    try {
      await ctx.deleteMessage();
    } catch (e) {
      // مهم نیست اگر موفق نشد
    }

    // Region گروه را پیدا کن
    const { data: region, error: regErr } = await supabase
      .from("regions")
      .select("id, title")
      .eq("telegram_chat_id", ctx.chat.id)
      .maybeSingle();

    if (regErr || !region) {
      await ctx.reply(
        "این گروه هنوز به عنوان Region ثبت نشده است.\n" +
          "اول از /worldadmin یا «ساخت منطقه» استفاده کن تا Region ثبت شود."
      );
      return;
    }

    // شروع ویزارد در پی‌وی ارباب
    if (!ctx.from) return;

    const baseState: PathWizardState = {
      mode: "create",
      step: "chooseTargetRegion",
      fromChatId: ctx.chat.id,
      fromRegionId: region.id,
      allowWalk: true,
      allowDrive: false,
      allowTransport: false,
      blockMount: false,
    };

    // ذخیره در session ارباب (در پی‌وی)
    // برای این کار باید یک پیام به پی‌وی بفرستیم
    await ctx.api.sendMessage(
      ctx.from.id,
      `🧵 شروع ساخت مسیر جدید برای Region:\n«${region.title}»\n\n` +
        "اول مقصد کلی را انتخاب کن:"
    );

    // حالا state را روی context جعلی برای پی‌وی ست می‌کنیم:
    (ctx as any).session = (ctx as any).session || {};
    setWizard(ctx, baseState);

    // لیست Regionها
    const { data: regions, error: regionsErr } = await supabase
      .from("regions")
      .select("id, title")
      .order("id", { ascending: true });

    if (regionsErr || !regions || regions.length === 0) {
      await ctx.api.sendMessage(
        ctx.from.id,
        "هیچ Region دیگری در جهان ثبت نشده است که بشود به آن مسیر ساخت."
      );
      setWizard(ctx, null);
      return;
    }

    // کیبورد انتخاب Region مقصد
    const kb = new InlineKeyboard();
    for (const r of regions as any[]) {
      kb.text(r.title, `pb:targetRegion:${r.id}`).row();
    }
    kb.text("❌ لغو", "pb:cancel");

    await ctx.api.sendMessage(ctx.from.id, "🎯 Region مقصد را انتخاب کن:", {
      reply_markup: kb,
    });
  });

  //
  // Helper: فقط برای پی‌وی ارباب و وقتی ویزارد فعال است
  //
  bot.callbackQuery(/^pb:/, async (ctx, next) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    return next();
  });

  //
  // لغو ویزارد
  //
  bot.callbackQuery("pb:cancel", async (ctx) => {
    const wiz = getWizard(ctx);
    if (!wiz) {
      await ctx.answerCallbackQuery();
      return;
    }
    setWizard(ctx, null);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("❌ فرایند ساخت مسیر لغو شد.");
  });

  //
  // انتخاب Region مقصد
  //
  bot.callbackQuery(/^pb:targetRegion:(\d+)$/, async (ctx) => {
    const wiz = getWizard(ctx);
    if (!wiz || wiz.mode !== "create") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const targetRegionId = Number(ctx.match![1]);
    const { supabase } = ctx.services;

    // چک اینکه Region وجود دارد
    const { data: targetRegion, error: regErr } = await supabase
      .from("regions")
      .select("id, title")
      .eq("id", targetRegionId)
      .maybeSingle();

    if (regErr || !targetRegion) {
      await ctx.reply("Region مقصد دیگر وجود ندارد.");
      return;
    }

    wiz.targetRegionId = targetRegionId;
    wiz.step = "chooseFromSpot";
    setWizard(ctx, wiz);

    // Spotهای مبدأ (Region گروه فعلی)
    const { data: fromSpots, error: fromSpotsErr } = await supabase
      .from("spots")
      .select("id, title")
      .eq("region_id", wiz.fromRegionId)
      .order("id", { ascending: true });

    if (fromSpotsErr || !fromSpots || fromSpots.length === 0) {
      await ctx.reply(
        "در Region مبدأ (گروه فعلی) هیچ Spotی ثبت نشده است.\n" +
          "اول با «ساخت منطقه» برای این Region Spot بساز."
      );
      setWizard(ctx, null);
      return;
    }

    const kb = new InlineKeyboard();
    for (const s of fromSpots as any[]) {
      kb.text(s.title, `pb:fromSpot:${s.id}`).row();
    }
    kb.text("❌ لغو", "pb:cancel");

    await ctx.editMessageText(
      "📍 مکان مبدأ را انتخاب کن (در Region فعلی):",
      { reply_markup: kb }
    );
  });

  //
  // انتخاب Spot مبدأ
  //
  bot.callbackQuery(/^pb:fromSpot:(\d+)$/, async (ctx) => {
    const wiz = getWizard(ctx);
    if (!wiz || wiz.mode !== "create") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const fromSpotId = Number(ctx.match![1]);
    wiz.fromSpotId = fromSpotId;
    wiz.step = "chooseToSpot";
    setWizard(ctx, wiz);

    const { supabase } = ctx.services;

    if (!wiz.targetRegionId) {
      await ctx.reply("Region مقصد مشخص نشده است. دوباره از اول شروع کن.");
      setWizard(ctx, null);
      return;
    }

    const { data: toSpots, error: toSpotsErr } = await supabase
      .from("spots")
      .select("id, title")
      .eq("region_id", wiz.targetRegionId)
      .order("id", { ascending: true });

    if (toSpotsErr || !toSpots || toSpots.length === 0) {
      await ctx.reply(
        "در Region مقصد هیچ Spotی ثبت نشده است.\n" +
          "اول برای Region مقصد Spot بساز."
      );
      setWizard(ctx, null);
      return;
    }

    const kb = new InlineKeyboard();
    for (const s of toSpots as any[]) {
      kb.text(s.title, `pb:toSpot:${s.id}`).row();
    }
    kb.text("❌ لغو", "pb:cancel");

    await ctx.editMessageText(
      "🎯 حالا مکان مقصد را انتخاب کن (در Region مقصد):",
      { reply_markup: kb }
    );
  });

  //
  // انتخاب Spot مقصد → می‌رویم سراغ گرفتن زمان سفر
  //
  bot.callbackQuery(/^pb:toSpot:(\d+)$/, async (ctx) => {
    const wiz = getWizard(ctx);
    if (!wiz || wiz.mode !== "create") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const toSpotId = Number(ctx.match![1]);
    wiz.toSpotId = toSpotId;
    wiz.step = "askTime";
    setWizard(ctx, wiz);

    await ctx.editMessageText(
      "⏳ زمان سفر پیاده را مشخص کن.\n\n" +
        "یک عدد به *دقیقه* بفرست (مثلاً 10 یعنی حدوداً ۱۰ دقیقه).\n" +
        "زمان رانندگی فعلاً به صورت خودکار حدود نصف آن محاسبه می‌شود، " +
        "بعداً می‌توانی در ویرایش مسیر دقیق‌تر تنظیم کنی.",
      { parse_mode: "Markdown" }
    );
  });

  //
  // پیام متنی در پی‌وی: اگر در مرحله askTime هستیم، زمان را می‌گیرد
  //
  bot.on("message:text", async (ctx, next) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID || ctx.chat?.type !== "private") {
      return next();
    }

    const wiz = getWizard(ctx);
    if (!wiz || wiz.mode !== "create" || wiz.step !== "askTime") {
      return next();
    }

    const txt = ctx.message.text.trim();
    const mins = Number(txt);

    if (!Number.isFinite(mins) || mins <= 0) {
      await ctx.reply("عدد معتبری نفرستادی. یک عدد مثبت به دقیقه بفرست (مثلاً 5 یا 12).");
      return;
    }

    const travelSeconds = Math.round(mins * 60);
    const driveSeconds = Math.round(travelSeconds * 0.5); // فعلاً رانندگی ≈ نصف پیاده

    wiz.travelSeconds = travelSeconds;
    wiz.driveSeconds = driveSeconds;
    wiz.step = "chooseDirection";
    setWizard(ctx, wiz);

    const kb = new InlineKeyboard()
      .text("یک‌طرفه (از مبدأ به مقصد)", "pb:dir:forward")
      .row()
      .text("یک‌طرفه (از مقصد به مبدأ)", "pb:dir:backward")
      .row()
      .text("دو طرفه (↔)", "pb:dir:both")
      .row()
      .text("❌ لغو", "pb:cancel");

    await ctx.reply(
      `⏳ زمان پیاده تنظیم شد: حدود ${mins} دقیقه.\n` +
        `زمان رانندگی فعلی: حدود ${Math.round(mins / 2)} دقیقه.\n\n` +
        "حالا جهت مسیر را انتخاب کن:",
      { reply_markup: kb }
    );
  });

  //
  // انتخاب جهت مسیر
  //
  bot.callbackQuery(/^pb:dir:(forward|backward|both)$/, async (ctx) => {
    const wiz = getWizard(ctx);
    if (!wiz || wiz.mode !== "create") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const dir = ctx.match![1] as DirectionMode;
    wiz.direction = dir;
    wiz.step = "chooseModes";
    setWizard(ctx, wiz);

    await ctx.editMessageText(
      "نوع حرکت‌هایی که روی این مسیر مجاز باشند را انتخاب کن.\n\n" +
        "هر دکمه را بزن تا تیکش عوض شود، بعد دکمه‌ی ثبت را بزن.",
      { reply_markup: buildModesKeyboard(wiz) }
    );
  });

  //
  // تغییر تیک حالت‌ها
  //
  bot.callbackQuery(/^pb:mode:(walk|drive|transport|blockmount)$/, async (ctx) => {
    const wiz = getWizard(ctx);
    if (!wiz || wiz.mode !== "create" || wiz.step !== "chooseModes") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const mode = ctx.match![1];

    if (mode === "walk") wiz.allowWalk = !wiz.allowWalk;
    if (mode === "drive") wiz.allowDrive = !wiz.allowDrive;
    if (mode === "transport") wiz.allowTransport = !wiz.allowTransport;
    if (mode === "blockmount") wiz.blockMount = !wiz.blockMount;

    setWizard(ctx, wiz);

    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: buildModesKeyboard(wiz),
      });
    } catch (e) {
      // اگر نشد، مهم نیست
    }
  });

  //
  // ثبت مسیر: یکبار یا همراه ادامه‌دادن
  //
  bot.callbackQuery(/^pb:save:(once|again)$/, async (ctx) => {
    const wiz = getWizard(ctx);
    if (!wiz || wiz.mode !== "create" || wiz.step !== "chooseModes") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const mode = ctx.match![1]; // once | again

    if (
      !wiz.fromSpotId ||
      !wiz.toSpotId ||
      !wiz.travelSeconds ||
      !wiz.direction
    ) {
      await ctx.reply("اطلاعات مسیر کامل نیست. دوباره از اول شروع کن.");
      setWizard(ctx, null);
      return;
    }

    const { supabase } = ctx.services;

    const edgesToInsert: any[] = [];

    const base = {
      travel_seconds: wiz.travelSeconds,
      drive_seconds: wiz.allowDrive ? wiz.driveSeconds ?? null : null,
      transport_seconds: wiz.allowTransport ? wiz.travelSeconds : null, // فعلاً همان
      allow_walk: wiz.allowWalk,
      allow_drive: wiz.allowDrive,
      allow_transport: wiz.allowTransport,
      block_mount: wiz.blockMount,
    };

    if (wiz.direction === "forward" || wiz.direction === "both") {
      edgesToInsert.push({
        from_spot_id: wiz.fromSpotId,
        to_spot_id: wiz.toSpotId,
        ...base,
      });
    }

    if (wiz.direction === "backward" || wiz.direction === "both") {
      edgesToInsert.push({
        from_spot_id: wiz.toSpotId,
        to_spot_id: wiz.fromSpotId,
        ...base,
      });
    }

    const { error: insErr } = await supabase
      .from("edges")
      .insert(edgesToInsert);

    if (insErr) {
      console.error("insert edges error:", insErr);
      await ctx.reply("در ثبت مسیر در دیتابیس مشکلی پیش آمد.");
      setWizard(ctx, null);
      return;
    }

    if (mode === "once") {
      setWizard(ctx, null);
      await ctx.editMessageText(
        "✅ مسیر(های) جدید ثبت شد.\n" +
          "هر زمان خواستی، دوباره «ساخت مسیر» بزن تا مسیر دیگری بسازی."
      );
    } else {
      // again: از همان مبدأ و Regionها، فقط مقصد را دوباره انتخاب کن
      wiz.step = "chooseToSpot";
      wiz.toSpotId = undefined;
      wiz.travelSeconds = undefined;
      wiz.driveSeconds = undefined;
      wiz.direction = undefined;
      // حالت‌ها را هم می‌توانیم نگه داریم، چون احتمالاً برای مسیرهای بعدی شبیه است
      setWizard(ctx, wiz);

      // دوباره Spotهای مقصد را لیست کن
      const { data: toSpots, error: toSpotsErr } = await supabase
        .from("spots")
        .select("id, title")
        .eq("region_id", wiz.targetRegionId)
        .order("id", { ascending: true });

      if (toSpotsErr || !toSpots || toSpots.length === 0) {
        await ctx.reply(
          "مسیر ثبت شد، اما دیگر Spotی در Region مقصد وجود ندارد که به آن وصل شوی."
        );
        setWizard(ctx, null);
        return;
      }

      const kb = new InlineKeyboard();
      for (const s of toSpots as any[]) {
        kb.text(s.title, `pb:toSpot:${s.id}`).row();
      }
      kb.text("❌ لغو", "pb:cancel");

      await ctx.editMessageText(
        "✅ مسیر ثبت شد.\n" +
          "برای ساخت مسیر بعدی، دوباره مقصد جدید را انتخاب کن:",
        { reply_markup: kb }
      );
    }
  });
}
