import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";

const MASTER_ID = Number(process.env.MASTER_ID || 0);

type WizardStep =
  | "chooseTargetKind"
  | "chooseTargetRegion"
  | "chooseFromSpot"
  | "chooseToSpot"
  | "askTime"
  | "chooseDirection"
  | "chooseModes";

type DirectionMode = "forward" | "backward" | "both";

interface PathWizardState {
  userId: number;
  fromChatId: number;
  fromRegionId: number;
  targetRegionId?: number;
  fromSpotId?: number;
  toSpotId?: number;
  travelSeconds?: number;
  driveSeconds?: number;
  direction?: DirectionMode;
  step: WizardStep;
  allowWalk: boolean;
  allowDrive: boolean;
  allowTransport: boolean;
  blockMount: boolean;
}

const wizardByUser = new Map<number, PathWizardState>();

function isMaster(ctx: MyContext): boolean {
  return !!ctx.from && ctx.from.id === MASTER_ID;
}

function getWizard(ctx: MyContext): PathWizardState | undefined {
  if (!ctx.from) return undefined;
  return wizardByUser.get(ctx.from.id);
}

function setWizard(ctx: MyContext, state: PathWizardState | null) {
  if (!ctx.from) return;
  if (state) wizardByUser.set(ctx.from.id, state);
  else wizardByUser.delete(ctx.from.id);
}

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

export function registerPathBuilderFeature(bot: Bot<MyContext>): void {
  bot.hears("ساخت مسیر", async (ctx) => {
    if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) {
      return;
    }

    if (!isMaster(ctx)) {
      await ctx.reply("🥷🏻 فقط ارباب من می‌تونه بهم دستور بده، حدت رو بدون.");
      return;
    }

    const { supabase } = ctx.services;

    try {
      await ctx.deleteMessage();
    } catch (e) {
      // ignore
    }

    const { data: region, error: regErr } = await supabase
      .from("regions")
      .select("id, title")
      .eq("telegram_chat_id", ctx.chat.id)
      .maybeSingle();

    if (regErr || !region) {
      await ctx.reply(
        "این گروه هنوز به عنوان Region ثبت نشده.\n" +
          "اول /worldadmin یا «ساخت منطقه» را بزن."
      );
      return;
    }

    if (!ctx.from) return;

    const baseState: PathWizardState = {
      userId: ctx.from.id,
      fromChatId: ctx.chat.id,
      fromRegionId: region.id,
      step: "chooseTargetKind",
      allowWalk: true,
      allowDrive: false,
      allowTransport: false,
      blockMount: false,
    };

    setWizard(ctx, baseState);

    await ctx.api.sendMessage(
      ctx.from.id,
      `🧵 شروع ساخت مسیر جدید برای Region: «${region.title}»\n\n` +
        "این مسیر قرار است به کجا وصل شود؟",
      {
        reply_markup: new InlineKeyboard()
          .text("داخل همین Region", "pb:kind:same")
          .row()
          .text("اتصال به Region دیگر", "pb:kind:other")
          .row()
          .text("❌ لغو", "pb:cancel"),
      }
    );
  });

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

  bot.callbackQuery(/^pb:kind:(same|other)$/, async (ctx) => {
    const wiz = getWizard(ctx);
    if (!wiz) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const kind = ctx.match![1];
    const { supabase } = ctx.services;

    if (kind === "same") {
      wiz.targetRegionId = wiz.fromRegionId;
      wiz.step = "chooseFromSpot";
      setWizard(ctx, wiz);

      const { data: spots, error } = await supabase
        .from("spots")
        .select("id, title")
        .eq("region_id", wiz.fromRegionId)
        .order("id", { ascending: true });

      if (error || !spots || spots.length === 0) {
        await ctx.editMessageText(
          "برای این Region هیچ Spotی ثبت نشده.\n" +
            "اول با ساخت منطقه / Spotها را اضافه کن."
        );
        setWizard(ctx, null);
        return;
      }

      const kb = new InlineKeyboard();
      for (const s of spots as any[]) {
        kb.text(s.title, `pb:fromSpot:${s.id}`).row();
      }
      kb.text("❌ لغو", "pb:cancel");

      await ctx.editMessageText(
        "📍 مبدأ را انتخاب کن (یکی از Spotهای همین Region):",
        { reply_markup: kb }
      );
    } else {
      wiz.step = "chooseTargetRegion";
      setWizard(ctx, wiz);

      const { data: regions, error } = await supabase
        .from("regions")
        .select("id, title")
        .order("id", { ascending: true });

      if (error || !regions || regions.length === 0) {
        await ctx.editMessageText("هیچ Region دیگری ثبت نشده.");
        setWizard(ctx, null);
        return;
      }

      const kb = new InlineKeyboard();
      for (const r of regions as any[]) {
        const label =
          r.id === wiz.fromRegionId
            ? `⭐ ${r.title} (همین Region)`
            : r.title;
        kb.text(label, `pb:targetRegion:${r.id}`).row();
      }
      kb.text("❌ لغو", "pb:cancel");

      await ctx.editMessageText("🎯 Region مقصد را انتخاب کن:", {
        reply_markup: kb,
      });
    }
  });

  bot.callbackQuery(/^pb:targetRegion:(\d+)$/, async (ctx) => {
    const wiz = getWizard(ctx);
    if (!wiz) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const targetRegionId = Number(ctx.match![1]);
    wiz.targetRegionId = targetRegionId;
    wiz.step = "chooseFromSpot";
    setWizard(ctx, wiz);

    const { supabase } = ctx.services;

    const { data: fromSpots, error } = await supabase
      .from("spots")
      .select("id, title")
      .eq("region_id", wiz.fromRegionId)
      .order("id", { ascending: true });

    if (error || !fromSpots || fromSpots.length === 0) {
      await ctx.editMessageText(
        "در Region مبدأ هیچ Spotی ثبت نشده.\n" + "اول Spot بساز."
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
      "📍 مبدأ را انتخاب کن (Spot در Region مبدأ):",
      { reply_markup: kb }
    );
  });

  bot.callbackQuery(/^pb:fromSpot:(\d+)$/, async (ctx) => {
    const wiz = getWizard(ctx);
    if (!wiz || !wiz.targetRegionId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const fromSpotId = Number(ctx.match![1]);
    wiz.fromSpotId = fromSpotId;
    wiz.step = "chooseToSpot";
    setWizard(ctx, wiz);

    const { supabase } = ctx.services;

    const { data: toSpots, error } = await supabase
      .from("spots")
      .select("id, title")
      .eq("region_id", wiz.targetRegionId)
      .order("id", { ascending: true });

    if (error || !toSpots || toSpots.length === 0) {
      await ctx.editMessageText(
        "در Region مقصد هیچ Spotی ثبت نشده.\n" +
          "اول Spot مقصد را بساز."
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
      "🎯 حالا مقصد را انتخاب کن (Spot در Region مقصد):",
      { reply_markup: kb }
    );
  });

  bot.callbackQuery(/^pb:toSpot:(\d+)$/, async (ctx) => {
    const wiz = getWizard(ctx);
    if (!wiz) {
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
        "یک عدد به *دقیقه* بفرست (مثلاً 10 یعنی حدوداً ۱۰ دقیقه).",
      { parse_mode: "Markdown" }
    );
  });

  bot.on("message:text", async (ctx, next) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID || ctx.chat?.type !== "private") {
      return next();
    }

    const wiz = getWizard(ctx);
    if (!wiz || wiz.step !== "askTime") {
      return next();
    }

    const txt = ctx.message.text.trim();
    const mins = Number(txt);

    if (!Number.isFinite(mins) || mins <= 0) {
      await ctx.reply("یک عدد مثبت (دقیقه) بفرست، مثل 5 یا 12.");
      return;
    }

    const travelSeconds = Math.round(mins * 60);
    const driveSeconds = Math.round(travelSeconds * 0.5);

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
      `⏳ زمان پیاده: حدود ${mins} دقیقه.\n` +
        `زمان رانندگی فعلی: ~${Math.round(mins / 2)} دقیقه.\n\n` +
        "جهت مسیر را انتخاب کن:",
      { reply_markup: kb }
    );
  });

  bot.callbackQuery(/^pb:dir:(forward|backward|both)$/, async (ctx) => {
    const wiz = getWizard(ctx);
    if (!wiz) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

    const dir = ctx.match![1] as DirectionMode;
    wiz.direction = dir;
    wiz.step = "chooseModes";
    setWizard(ctx, wiz);

    await ctx.editMessageText(
      "نوع حرکت‌های مجاز روی این مسیر را انتخاب کن.\n\n" +
        "هر دکمه را بزن تا تیکش عوض شود، بعد دکمه‌ی ثبت را بزن.",
      { reply_markup: buildModesKeyboard(wiz) }
    );
  });

  bot.callbackQuery(
    /^pb:mode:(walk|drive|transport|blockmount)$/,
    async (ctx) => {
      const wiz = getWizard(ctx);
      if (!wiz || wiz.step !== "chooseModes") {
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
        // ignore
      }
    }
  );

  bot.callbackQuery(/^pb:save:(once|again)$/, async (ctx) => {
    const wiz = getWizard(ctx);
    if (!wiz || wiz.step !== "chooseModes") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();

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

    const base = {
      travel_seconds: wiz.travelSeconds,
      drive_seconds: wiz.allowDrive ? wiz.driveSeconds ?? null : null,
      transport_seconds: wiz.allowTransport ? wiz.travelSeconds : null,
      allow_walk: wiz.allowWalk,
      allow_drive: wiz.allowDrive,
      allow_transport: wiz.allowTransport,
      block_mount: wiz.blockMount,
    };

    const edgesToInsert: any[] = [];

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

    const mode = ctx.match![1];

    if (mode === "once") {
      setWizard(ctx, null);
      await ctx.editMessageText(
        "✅ مسیر(های) جدید ثبت شد.\n" +
          "هر وقت خواستی، دوباره «ساخت مسیر» را بزن تا مسیر دیگری بسازی."
      );
    } else {
      wiz.toSpotId = undefined;
      wiz.travelSeconds = undefined;
      wiz.driveSeconds = undefined;
      wiz.direction = undefined;
      wiz.step = "chooseToSpot";
      setWizard(ctx, wiz);

      const { data: toSpots, error } = await supabase
        .from("spots")
        .select("id, title")
        .eq("region_id", wiz.targetRegionId)
        .order("id", { ascending: true });

      if (error || !toSpots || toSpots.length === 0) {
        await ctx.editMessageText(
          "مسیر ثبت شد، اما Spot دیگری در Region مقصد وجود ندارد."
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
          "برای ساخت مسیر بعدی، مقصد جدید را انتخاب کن:",
        { reply_markup: kb }
      );
    }
  });
}
