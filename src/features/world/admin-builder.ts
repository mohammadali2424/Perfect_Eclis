import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

type ClanKey = "walker" | "stellarieth" | "necroshade" | "torrentress" | "neutral";

function clanLabel(key: ClanKey): string {
  switch (key) {
    case "walker":
      return "⚡ 𝐖𝐚𝐥𝐤𝐞𝐫";
    case "stellarieth":
      return "🪽 𝐒𝐭𝐞𝐥𝐥𝐚𝐫𝐢𝐞𝐭𝐡";
    case "necroshade":
      return "🖤 𝐍𝐞𝐜𝐫𝐨𝐬𝐡𝐚𝐝𝐞";
    case "torrentress":
      return "🌟 𝐓𝐨𝐫𝐫𝐞𝐧𝐭𝐫𝐞𝐬𝐬";
    case "neutral":
      return "⚪ 𝙉𝙚𝙪𝙩𝙧𝙖𝙡";
    default:
      return key;
  }
}

function clanKeys(): ClanKey[] {
  return ["walker", "stellarieth", "necroshade", "torrentress", "neutral"];
}

// حالت "صفحه" برای پی‌وی ارباب
async function sendScreen(ctx: MyContext, text: string, kb?: InlineKeyboard) {
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { reply_markup: kb });
      return;
    } catch (e) {
      console.warn("admin sendScreen edit failed, fallback to reply:", e);
    }
  }
  await ctx.reply(text, { reply_markup: kb });
}

function regionPanelKeyboard(regionId: number, hasClan: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(hasClan ? "🏳️ تغییر خاندان" : "🏳️ انتخاب خاندان", `admin:setclan:${regionId}`).row();
  kb.text("📍 Spot جدید", `admin:addspot:${regionId}`).row();
  kb.text("📜 لیست Spotها", `admin:listspots:${regionId}`).row();
  kb.text("🔗 Edge جدید", `admin:addedge:${regionId}`).row();
  kb.text("🧬 لیست Edgeها", `admin:listedges:${regionId}`).row();
  kb.text("🗑 حذف Spot", `admin:delspot:${regionId}`).row();
  kb.text("🗑 حذف Edge", `admin:deledge:${regionId}`);
  return kb;
}

// کمک‌کننده برای قفل‌ها
async function showRegionLockMenu(ctx: MyContext, regionId: number) {
  const { supabase } = ctx.services;

  const { data: region, error } = await supabase
    .from("regions")
    .select("*")
    .eq("id", regionId)
    .maybeSingle();

  if (error || !region) {
    await sendScreen(ctx, "این Region در دیتابیس پیدا نشد.");
    return;
  }

  const kb = new InlineKeyboard()
    .text(region.is_locked ? "🔓 باز کردن Region" : "🔒 قفل کردن Region", `lock:region:${region.id}`)
    .row()
    .text("🧬 قفل/بازکردن مسیرهای این Region", `lock:edges:${region.id}`);

  const text =
    "🔐 مدیریت قفل Region\n" +
    "───────────────\n" +
    `نام: ${region.title}\n` +
    `region_id: ${region.id}\n` +
    `وضعیت: ${region.is_locked ? "قفل 🔒" : "باز 🔓"}`;

  await sendScreen(ctx, text, kb);
}

async function showEdgeLockMenu(ctx: MyContext, regionId: number) {
  const { supabase } = ctx.services;

  const { data: spots, error: spotErr } = await supabase
    .from("spots")
    .select("*")
    .eq("region_id", regionId);

  if (spotErr || !spots || spots.length === 0) {
    await sendScreen(ctx, "برای این Region هنوز Spotی تعریف نشده.");
    return;
  }

  const spotIds = spots.map((s: any) => s.id as number);
  const spotMap = new Map<number, any>();
  for (const s of spots) spotMap.set(s.id, s);

  const { data: edges, error: edgeErr } = await supabase
    .from("edges")
    .select("*");

  if (edgeErr || !edges || edges.length === 0) {
    await sendScreen(ctx, "هیچ Edgeی در جهان تعریف نشده.");
    return;
  }

  const related = edges.filter(
    (e: any) =>
      spotIds.includes(e.from_spot_id as number) ||
      spotIds.includes(e.to_spot_id as number)
  );

  if (related.length === 0) {
    await sendScreen(ctx, "هیچ Edgeی مرتبط با این Region پیدا نشد.");
    return;
  }

  const kb = new InlineKeyboard();
  for (const e of related) {
    const fromSpot = spotMap.get(e.from_spot_id);
    const toSpot = spotMap.get(e.to_spot_id);
    const baseLabel = `${fromSpot?.title || e.from_spot_id} → ${
      toSpot?.title || e.to_spot_id
    } (${e.travel_seconds}ث)`;
    const icon = e.is_locked ? "🔒" : "🔓";
    kb.text(`${icon} ${baseLabel}`, `lock:edge:${regionId}:${e.id}`).row();
  }

  const text =
    "🧬 قفل/بازکردن مسیرهای این Region\n" +
    "فقط Edge‌هایی که به Spotهای این Region وصل‌اند لیست شده‌اند.\n\n" +
    "روی هر کدام که بزنی، وضعیت قفلش برعکس می‌شود.";

  await sendScreen(ctx, text, kb);
}

export function registerWorldAdminFeature(bot: Bot<MyContext>): void {
  // /worldadmin داخل گروه → ثبت/خواندن Region + ارسال پنل به پی‌وی ارباب
  bot.command("worldadmin", async (ctx) => {
    const chat = ctx.chat;

    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      await ctx.reply("🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون");
      return;
    }

    if (!chat || chat.type === "private") {
      await ctx.reply("برای ثبت Region باید این دستور را داخل یک گروه بفرستی.");
      return;
    }

    const { supabase } = ctx.services;
    const chatId = chat.id;
    const title = chat.title || "Region بدون نام";

    const { data: existing, error: exErr } = await supabase
      .from("regions")
      .select("*")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();

    let regionId: number;
    let clanName: string | null = null;

    if (exErr) {
      console.error("regions select error:", exErr);
      return;
    }

    if (existing) {
      regionId = existing.id;
      clanName = existing.clan_name || null;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("regions")
        .insert({
          title,
          telegram_chat_id: chatId,
        })
        .select("*")
        .maybeSingle();

      if (insErr || !inserted) {
        console.error("regions insert error:", insErr);
        return;
      }

      regionId = inserted.id;
      clanName = inserted.clan_name || null;
    }

    // حذف پیام دستور در گروه، بدون هیچ پیام دیگری
    try {
      if (ctx.message) {
        await ctx.deleteMessage();
      }
    } catch (e) {
      console.warn("delete worldadmin message failed:", e);
    }

    // ارسال پنل به پی‌وی ارباب
    try {
      const kb = regionPanelKeyboard(regionId, !!clanName);

      await ctx.api.sendMessage(
        MASTER_ID,
        "🧩 پنل جهان‌ساز برای این Region:\n\n" +
          `نام: ${title}\n` +
          `chat_id: ${chatId}\n` +
          `region_id: ${regionId}\n` +
          `خاندان: ${clanName || "هنوز تعیین نشده"}\n\n` +
          "با دکمه‌ها می‌توانی Spot بسازی، Edge تعریف کنی و جهان را شکل بدهی.",
        { reply_markup: kb }
      );
    } catch (e) {
      console.error("send worldadmin panel to MASTER failed:", e);
    }
  });

  // دستور «قفل» داخل گروه → قفل Region / مسیرها
  bot.hears("قفل", async (ctx) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) return;
    if (!ctx.chat || ctx.chat.type === "private") return;

    const { supabase } = ctx.services;
    const chatId = ctx.chat.id;

    // پیام قفل را در گروه پاک کن
    try {
      if (ctx.message) await ctx.deleteMessage();
    } catch (e) {
      console.warn("delete قفل message failed:", e);
    }

    const { data: region, error } = await supabase
      .from("regions")
      .select("*")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();

    if (error || !region) {
      await ctx.api.sendMessage(
        MASTER_ID,
        "🔐 دستور «قفل» در گروهی زده شد که هنوز به عنوان Region ثبت نشده.\n" +
          "اول در آن گروه /worldadmin بزن."
      );
      return;
    }

    await ctx.api.sendMessage(
      MASTER_ID,
      "🔐 مدیریت قفل برای Region:\n" +
        `نام: ${region.title}\n` +
        `region_id: ${region.id}`,
      {
        reply_markup: new InlineKeyboard()
          .text(
            region.is_locked ? "🔓 باز کردن Region" : "🔒 قفل کردن Region",
            `lock:region:${region.id}`
          )
          .row()
          .text("🧬 قفل/بازکردن مسیرهای این Region", `lock:edges:${region.id}`),
      }
    );
  });

  // متنی در پی‌وی: «مدیریت مناطق»
  bot.hears("مدیریت مناطق", async (ctx) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      await ctx.reply("🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون");
      return;
    }
    if (ctx.chat?.type !== "private") return;

    const kb = new InlineKeyboard();
    kb.text(clanLabel("walker"), "admin:regions:walker").row();
    kb.text(clanLabel("stellarieth"), "admin:regions:stellarieth").row();
    kb.text(clanLabel("necroshade"), "admin:regions:necroshade").row();
    kb.text(clanLabel("torrentress"), "admin:regions:torrentress").row();
    kb.text(clanLabel("neutral"), "admin:regions:neutral").row();
    kb.text("همه مناطق", "admin:regions:all");

    await ctx.reply("برای شروع، یک خاندان یا فیلتر برای نمایش مناطق انتخاب کن:", {
      reply_markup: kb,
    });
  });

  // پیام متنی برای state ساخت Spot و زمان Edge
  bot.on("message:text", async (ctx, next) => {
    if (!ctx.from || ctx.from.id !== MASTER_ID) return next();
    if (ctx.chat?.type !== "private") return next();

    const mode = ctx.session.admin_mode;
    const regionId = ctx.session.admin_region_id;
    const fromSpotId = ctx.session.admin_from_spot_id;
    const toSpotId = ctx.session.admin_to_spot_id;
    const { supabase } = ctx.services;
    const text = ctx.message.text.trim();

    // ساخت Spot جدید
    if (mode === "add_spot" && regionId) {
      if (!text) {
        await ctx.reply("نام Spot نمی‌تواند خالی باشد. دوباره تلاش کن.");
        return;
      }

      const { error: insErr } = await supabase.from("spots").insert({
        region_id: regionId,
        title: text,
      });

      ctx.session.admin_mode = undefined;
      ctx.session.admin_region_id = undefined;

      if (insErr) {
        console.error("insert spot error:", insErr);
        await ctx.reply("در ساخت Spot جدید مشکلی پیش آمد.");
        return;
      }

      await ctx.reply("📍 Spot جدید ساخته شد ✅");
      return;
    }

    // زمان سفر Edge (یک‌طرفه / دوطرفه)
    if (mode === "add_edge_time" && regionId && fromSpotId && toSpotId) {
      const seconds = Number(text);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        await ctx.reply("زمان سفر باید یک عدد مثبت (بر حسب ثانیه) باشد.");
        return;
      }

      const twoSided = !!ctx.session.admin_edge_twosided;

      let error: any = null;
      if (twoSided) {
        const { error: insErr } = await supabase.from("edges").insert([
          {
            from_spot_id: fromSpotId,
            to_spot_id: toSpotId,
            travel_seconds: Math.floor(seconds),
          },
          {
            from_spot_id: toSpotId,
            to_spot_id: fromSpotId,
            travel_seconds: Math.floor(seconds),
          },
        ]);
        error = insErr;
      } else {
        const { error: insErr } = await supabase.from("edges").insert({
          from_spot_id: fromSpotId,
          to_spot_id: toSpotId,
          travel_seconds: Math.floor(seconds),
        });
        error = insErr;
      }

      ctx.session.admin_mode = undefined;
      ctx.session.admin_region_id = undefined;
      ctx.session.admin_from_spot_id = undefined;
      ctx.session.admin_to_spot_id = undefined;
      ctx.session.admin_edge_twosided = undefined;

      if (error) {
        console.error("insert edge error:", error);
        await ctx.reply("در ساخت Edge جدید مشکلی پیش آمد.");
        return;
      }

      await ctx.reply(
        twoSided
          ? "🔁 Edge دوطرفه ساخته شد ✅"
          : "➡️ Edge یک‌طرفه ساخته شد ✅"
      );
      return;
    }

    return next();
  });

  // همه callbackهای admin + lock
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";

    const isAdminAction = data.startsWith("admin:");
    const isLockAction = data.startsWith("lock:");

    if ((isAdminAction || isLockAction) && (!ctx.from || ctx.from.id !== MASTER_ID)) {
      await ctx.answerCallbackQuery({
        text: "🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون",
        show_alert: true,
      });
      return;
    }

    const { supabase } = ctx.services;

    // --- قفل‌ها ---

    if (data.startsWith("lock:region:")) {
      await ctx.answerCallbackQuery();
      const regionId = Number(data.split(":")[2]);

      const { data: region, error } = await supabase
        .from("regions")
        .select("*")
        .eq("id", regionId)
        .maybeSingle();

      if (error || !region) {
        await sendScreen(ctx, "این Region در دیتابیس پیدا نشد.");
        return;
      }

      const newLocked = !region.is_locked;

      const { error: upErr } = await supabase
        .from("regions")
        .update({ is_locked: newLocked })
        .eq("id", regionId);

      if (upErr) {
        console.error("lock region update error:", upErr);
        await sendScreen(ctx, "در تغییر وضعیت قفل Region مشکلی پیش آمد.");
        return;
      }

      await showRegionLockMenu(ctx, regionId);
      return;
    }

    if (data.startsWith("lock:edges:")) {
      await ctx.answerCallbackQuery();
      const regionId = Number(data.split(":")[2]);
      await showEdgeLockMenu(ctx, regionId);
      return;
    }

    if (data.startsWith("lock:edge:")) {
      await ctx.answerCallbackQuery();
      const parts = data.split(":");
      const regionId = Number(parts[2]);
      const edgeId = Number(parts[3]);

      const { data: edge, error } = await supabase
        .from("edges")
        .select("*")
        .eq("id", edgeId)
        .maybeSingle();

      if (error || !edge) {
        await sendScreen(ctx, "این Edge در دیتابیس پیدا نشد.");
        return;
      }

      const newLocked = !edge.is_locked;

      const { error: upErr } = await supabase
        .from("edges")
        .update({ is_locked: newLocked })
        .eq("id", edgeId);

      if (upErr) {
        console.error("lock edge update error:", upErr);
        await sendScreen(ctx, "در قفل/بازکردن این Edge مشکلی پیش آمد.");
        return;
      }

      await showEdgeLockMenu(ctx, regionId);
      return;
    }

    // --- admin:regions:... نمایش مناطق بر اساس خاندان/همه ---

    if (data.startsWith("admin:regions:")) {
      await ctx.answerCallbackQuery();
      const key = data.split(":")[2]; // walker | ... | all

      let query = supabase.from("regions").select("*").order("id", {
        ascending: true,
      });

      if (key !== "all") {
        if (key === "neutral") {
          query = query.is("clan_name", null);
        } else {
          const label = clanLabel(key as ClanKey);
          query = query.eq("clan_name", label);
        }
      }

      const { data: regions, error } = await query;

      if (error) {
        console.error("list regions error:", error);
        await sendScreen(ctx, "در خواندن لیست مناطق خطایی رخ داد.");
        return;
      }

      if (!regions || regions.length === 0) {
        await sendScreen(ctx, "هیچ Region با این فیلتر پیدا نشد.");
        return;
      }

      const kb = new InlineKeyboard();
      for (const r of regions) {
        const name = r.title || `Region #${r.id}`;
        kb.text(name, `admin:openregion:${r.id}`).row();
      }

      await sendScreen(ctx, "یکی از Regionها را انتخاب کن:", {
        reply_markup: kb,
      } as any);
      return;
    }

    // باز کردن پنل Region
    if (data.startsWith("admin:openregion:")) {
      await ctx.answerCallbackQuery();
      const regionId = Number(data.split(":")[2]);

      const { data: region, error } = await supabase
        .from("regions")
        .select("*")
        .eq("id", regionId)
        .maybeSingle();

      if (error || !region) {
        await sendScreen(ctx, "این Region در دیتابیس پیدا نشد.");
        return;
      }

      const kb = regionPanelKeyboard(region.id, !!region.clan_name);

      const text =
        "🧩 پنل Region\n" +
        "───────────────\n" +
        `نام: ${region.title}\n` +
        `chat_id: ${region.telegram_chat_id}\n` +
        `region_id: ${region.id}\n` +
        `خاندان: ${region.clan_name || "هنوز تعیین نشده"}`;

      await sendScreen(ctx, text, kb);
      return;
    }

    // ست/تغییر خاندان Region (مرحله ۱)
    if (data.startsWith("admin:setclan:")) {
      const regionId = Number(data.split(":")[2]);

      const kb = new InlineKeyboard();
      for (const k of clanKeys()) {
        kb.text(clanLabel(k), `admin:setclan2:${regionId}:${k}`).row();
      }

      await ctx.answerCallbackQuery();
      await sendScreen(ctx, "این Region زیرمجموعه کدام خاندان/بی‌طرف است؟", kb);
      return;
    }

    // ست/تغییر خاندان Region (مرحله ۲)
    if (data.startsWith("admin:setclan2:")) {
      const parts = data.split(":");
      const regionId = Number(parts[2]);
      const clanKey = parts[3] as ClanKey;

      const label =
        clanKey === "neutral" ? null : clanLabel(clanKey as ClanKey);

      const { error } = await supabase
        .from("regions")
        .update({ clan_name: label })
        .eq("id", regionId);

      if (error) {
        console.error("set region clan error:", error);
        await ctx.answerCallbackQuery({
          text: "در ثبت خاندان Region خطایی رخ داد.",
          show_alert: true,
        });
        return;
      }

      await ctx.answerCallbackQuery({
        text: "خاندان Region ثبت شد.",
        show_alert: false,
      });

      await sendScreen(
        ctx,
        `خاندان این Region روی ${label || "Neutral / بی‌طرف"} تنظیم شد.`
      );
      return;
    }

    // Spot جدید
    if (data.startsWith("admin:addspot:")) {
      await ctx.answerCallbackQuery();
      const regionId = Number(data.split(":")[2]);

      ctx.session.admin_mode = "add_spot";
      ctx.session.admin_region_id = regionId;

      await sendScreen(
        ctx,
        "نام Spot جدید برای این Region را بفرست.\n" +
          "مثال: «بازار مرکزی» یا «دروازه شمالی»"
      );
      return;
    }

    // لیست Spotها
    if (data.startsWith("admin:listspots:")) {
      await ctx.answerCallbackQuery();
      const regionId = Number(data.split(":")[2]);

      const { data: spots, error } = await supabase
        .from("spots")
        .select("*")
        .eq("region_id", regionId)
        .order("id", { ascending: true });

      if (error) {
        console.error("list spots error:", error);
        await sendScreen(ctx, "در خواندن Spotها مشکلی پیش آمد.");
        return;
      }

      if (!spots || spots.length === 0) {
        await sendScreen(ctx, "برای این Region هنوز هیچ Spotی تعریف نشده.");
        return;
      }

      let text = "📍 Spotهای این Region:\n\n";
      for (const s of spots) {
        text += `#${s.id} — ${s.title}\n`;
      }

      await sendScreen(ctx, text);
      return;
    }

    // Edge جدید (مرحله ۱: انتخاب Spot مبدا در Region فعلی)
    if (data.startsWith("admin:addedge:")) {
      await ctx.answerCallbackQuery();
      const regionId = Number(data.split(":")[2]);

      const { data: spots, error } = await supabase
        .from("spots")
        .select("*")
        .eq("region_id", regionId)
        .order("id", { ascending: true });

      if (error || !spots || spots.length === 0) {
        await sendScreen(
          ctx,
          "برای این Region هنوز Spotی تعریف نشده که بتوان مسیری ساخت."
        );
        return;
      }

      const kb = new InlineKeyboard();
      for (const s of spots) {
        kb.text(s.title, `admin:edge_from:${regionId}:${s.id}`).row();
      }

      await sendScreen(ctx, "مبدا Edge را (Spot مبدأ) انتخاب کن:", kb);
      return;
    }

    // Edge جدید (مرحله ۲: انتخاب خاندان مقصد)
    if (data.startsWith("admin:edge_from:")) {
      await ctx.answerCallbackQuery();
      const parts = data.split(":");
      const fromRegionId = Number(parts[2]);
      const fromSpotId = Number(parts[3]);

      const kb = new InlineKeyboard();
      kb.text(clanLabel("walker"), `admin:edge_destclan:${fromRegionId}:${fromSpotId}:walker`).row();
      kb.text(clanLabel("stellarieth"), `admin:edge_destclan:${fromRegionId}:${fromSpotId}:stellarieth`).row();
      kb.text(clanLabel("necroshade"), `admin:edge_destclan:${fromRegionId}:${fromSpotId}:necroshade`).row();
      kb.text(clanLabel("torrentress"), `admin:edge_destclan:${fromRegionId}:${fromSpotId}:torrentress`).row();
      kb.text(clanLabel("neutral"), `admin:edge_destclan:${fromRegionId}:${fromSpotId}:neutral`).row();
      kb.text("همه مناطق", `admin:edge_destclan:${fromRegionId}:${fromSpotId}:all`);

      await sendScreen(
        ctx,
        "خاندان/بی‌طرف/همه برای Region مقصد را انتخاب کن:",
        kb
      );
      return;
    }

    // Edge جدید (مرحله ۳: انتخاب Region مقصد بر اساس خاندان)
    if (data.startsWith("admin:edge_destclan:")) {
      await ctx.answerCallbackQuery();
      const parts = data.split(":");
      const fromRegionId = Number(parts[2]);
      const fromSpotId = Number(parts[3]);
      const clanKey = parts[4]; // walker | ... | neutral | all

      let query = supabase.from("regions").select("*").order("id", {
        ascending: true,
      });

      if (clanKey !== "all") {
        if (clanKey === "neutral") {
          query = query.is("clan_name", null);
        } else {
          const label = clanLabel(clanKey as ClanKey);
          query = query.eq("clan_name", label);
        }
      }

      const { data: regions, error } = await query;

      if (error) {
        console.error("edge dest region list error:", error);
        await sendScreen(ctx, "در خواندن Regionهای مقصد مشکلی پیش آمد.");
        return;
      }

      if (!regions || regions.length === 0) {
        await sendScreen(ctx, "Region مناسبی برای این فیلتر پیدا نشد.");
        return;
      }

      const kb = new InlineKeyboard();
      for (const r of regions) {
        const name = r.title || `Region #${r.id}`;
        kb.text(
          name,
          `admin:edge_destreg:${fromRegionId}:${fromSpotId}:${r.id}`
        ).row();
      }

      await sendScreen(ctx, "Region مقصد را انتخاب کن:", kb);
      return;
    }

    // Edge جدید (مرحله ۴: انتخاب Spot مقصد در Region مقصد)
    if (data.startsWith("admin:edge_destreg:")) {
      await ctx.answerCallbackQuery();
      const parts = data.split(":");
      const fromRegionId = Number(parts[2]);
      const fromSpotId = Number(parts[3]);
      const toRegionId = Number(parts[4]);

      const { data: spots, error } = await supabase
        .from("spots")
        .select("*")
        .eq("region_id", toRegionId)
        .order("id", { ascending: true });

      if (error || !spots || spots.length === 0) {
        await sendScreen(
          ctx,
          "برای Region مقصد هنوز هیچ Spotی تعریف نشده."
        );
        return;
      }

      const kb = new InlineKeyboard();
      for (const s of spots) {
        kb.text(
          s.title,
          `admin:edge_to:${fromRegionId}:${fromSpotId}:${toRegionId}:${s.id}`
        ).row();
      }

      await sendScreen(ctx, "Spot مقصد را انتخاب کن:", kb);
      return;
    }

    // Edge جدید (مرحله ۵: انتخاب یک‌طرفه / دوطرفه)
    if (data.startsWith("admin:edge_to:")) {
      await ctx.answerCallbackQuery();
      const parts = data.split(":");
      const fromRegionId = Number(parts[2]);
      const fromSpotId = Number(parts[3]);
      const toRegionId = Number(parts[4]);
      const toSpotId = Number(parts[5]);

      ctx.session.admin_region_id = fromRegionId;
      ctx.session.admin_from_spot_id = fromSpotId;
      ctx.session.admin_to_spot_id = toSpotId;
      ctx.session.admin_edge_twosided = false;

      const kb = new InlineKeyboard()
        .text(
          "➡️ مسیر یک‌طرفه",
          `admin:edge_dir:${fromRegionId}:${fromSpotId}:${toRegionId}:${toSpotId}:one`
        )
        .row()
        .text(
          "🔁 مسیر دوطرفه",
          `admin:edge_dir:${fromRegionId}:${fromSpotId}:${toRegionId}:${toSpotId}:two`
        );

      await sendScreen(
        ctx,
        "این مسیر یک‌طرفه باشد یا دوطرفه؟\n\n" +
          "یک‌طرفه: فقط از مبدأ به مقصد.\n" +
          "دوطرفه: هم از مبدأ به مقصد، هم از مقصد به مبدأ.",
        kb
      );
      return;
    }

    // Edge جدید (مرحله ۶: بعد انتخاب جهت → سوال زمان سفر)
    if (data.startsWith("admin:edge_dir:")) {
      await ctx.answerCallbackQuery();
      const parts = data.split(":");
      const fromRegionId = Number(parts[2]);
      const fromSpotId = Number(parts[3]);
      const toRegionId = Number(parts[4]);
      const toSpotId = Number(parts[5]);
      const mode = parts[6]; // one | two

      ctx.session.admin_region_id = fromRegionId;
      ctx.session.admin_from_spot_id = fromSpotId;
      ctx.session.admin_to_spot_id = toSpotId;
      ctx.session.admin_edge_twosided = mode === "two";
      ctx.session.admin_mode = "add_edge_time";

      await sendScreen(
        ctx,
        "مدت زمان سفر بین این دو Spot را به ثانیه بفرست.\n" +
          "مثال: 600"
      );
      return;
    }

    // لیست Edgeها برای یک Region (فقط Edgeهایی که یکی از Spotهایش مربوط به این Region است)
    if (data.startsWith("admin:listedges:")) {
      await ctx.answerCallbackQuery();
      const regionId = Number(data.split(":")[2]);

      const { data: spots, error: spotErr } = await supabase
        .from("spots")
        .select("*")
        .eq("region_id", regionId);

      if (spotErr || !spots || spots.length === 0) {
        await sendScreen(ctx, "برای این Region Spotی پیدا نشد.");
        return;
      }

      const spotMap = new Map<number, any>();
      const spotIds = spots.map((s: any) => s.id as number);
      for (const s of spots) spotMap.set(s.id, s);

      const { data: edges, error: edgeErr } = await supabase
        .from("edges")
        .select("*");

      if (edgeErr || !edges || edges.length === 0) {
        await sendScreen(ctx, "هیچ Edgeی در جهان تعریف نشده.");
        return;
      }

      let text = "🧬 Edgeهای مرتبط با Spotهای این Region:\n\n";
      let count = 0;

      for (const e of edges) {
        const inRegion =
          spotIds.includes(e.from_spot_id as number) ||
          spotIds.includes(e.to_spot_id as number);
        if (!inRegion) continue;

        const fromSpot = spotMap.get(e.from_spot_id);
        const toSpot = spotMap.get(e.to_spot_id);
        const lockIcon = e.is_locked ? "🔒" : "🔓";

        text += `#${e.id} — ${lockIcon} ${fromSpot?.title || e.from_spot_id} → ${
          toSpot?.title || e.to_spot_id
        } (${e.travel_seconds}ث)\n`;
        count++;
      }

      if (count === 0) {
        await sendScreen(
          ctx,
          "هیچ Edgeی که به Spotهای این Region وصل باشد پیدا نشد."
        );
        return;
      }

      await sendScreen(ctx, text);
      return;
    }

    // حذف Spot (مرحله ۱)
    if (data.startsWith("admin:delspot:")) {
      await ctx.answerCallbackQuery();
      const regionId = Number(data.split(":")[2]);

      const { data: spots, error } = await supabase
        .from("spots")
        .select("*")
        .eq("region_id", regionId)
        .order("id", { ascending: true });

      if (error || !spots || spots.length === 0) {
        await sendScreen(
          ctx,
          "برای این Region Spotی وجود ندارد که حذف شود."
        );
        return;
      }

      const kb = new InlineKeyboard();
      for (const s of spots) {
        kb.text(`🗑 ${s.title}`, `admin:delspot2:${regionId}:${s.id}`).row();
      }

      await sendScreen(ctx, "کدام Spot را می‌خواهی حذف کنی؟", kb);
      return;
    }

    // حذف Spot (مرحله ۲)
    if (data.startsWith("admin:delspot2:")) {
      const parts = data.split(":");
      const regionId = Number(parts[2]);
      const spotId = Number(parts[3]);

      const { error } = await supabase
        .from("spots")
        .delete()
        .eq("id", spotId)
        .eq("region_id", regionId);

      if (error) {
        console.error("delete spot error:", error);
        await ctx.answerCallbackQuery({
          text: "در حذف Spot خطایی رخ داد.",
          show_alert: true,
        });
        return;
      }

      await ctx.answerCallbackQuery({ text: "Spot حذف شد.", show_alert: false });
      await sendScreen(
        ctx,
        "Spot انتخاب‌شده حذف شد ✅\n" +
          "(اگر Edgeهای متصل بوده، به‌خاطر FK احتمالاً آن‌ها هم حذف شده‌اند)."
      );
      return;
    }

    // حذف Edge (مرحله ۱: انتخاب از لیست)
    if (data.startsWith("admin:deledge:")) {
      await ctx.answerCallbackQuery();
      const regionId = Number(data.split(":")[2]);

      const { data: spots, error: spotErr } = await supabase
        .from("spots")
        .select("*")
        .eq("region_id", regionId);

      if (spotErr || !spots || spots.length === 0) {
        await sendScreen(ctx, "برای این Region Spotی وجود ندارد.");
        return;
      }

      const spotMap = new Map<number, any>();
      const spotIds = spots.map((s: any) => s.id as number);
      for (const s of spots) spotMap.set(s.id, s);

      const { data: edges, error: edgeErr } = await supabase
        .from("edges")
        .select("*");

      if (edgeErr || !edges || edges.length === 0) {
        await sendScreen(ctx, "هیچ Edgeی برای حذف وجود ندارد.");
        return;
      }

      const kb = new InlineKeyboard();
      let count = 0;
      for (const e of edges) {
        const inRegion =
          spotIds.includes(e.from_spot_id as number) ||
          spotIds.includes(e.to_spot_id as number);
        if (!inRegion) continue;

        const fromSpot = spotMap.get(e.from_spot_id);
        const toSpot = spotMap.get(e.to_spot_id);
        const label = `${fromSpot?.title || e.from_spot_id} → ${
          toSpot?.title || e.to_spot_id
        } (${e.travel_seconds}ث)`;
        kb.text(label, `admin:deledge2:${e.id}`).row();
        count++;
      }

      if (count === 0) {
        await sendScreen(
          ctx,
          "هیچ Edgeی مرتبط با این Region برای حذف پیدا نشد."
        );
        return;
      }

      await sendScreen(ctx, "کدام Edge را می‌خواهی حذف کنی؟", kb);
      return;
    }

    // حذف Edge (مرحله ۲)
    if (data.startsWith("admin:deledge2:")) {
      const edgeId = Number(data.split(":")[2]);

      const { error } = await supabase
        .from("edges")
        .delete()
        .eq("id", edgeId);

      if (error) {
        console.error("delete edge error:", error);
        await ctx.answerCallbackQuery({
          text: "در حذف Edge خطایی رخ داد.",
          show_alert: true,
        });
        return;
      }

      await ctx.answerCallbackQuery({
        text: "Edge حذف شد.",
        show_alert: false,
      });
      await sendScreen(ctx, "Edge انتخاب‌شده حذف شد ✅");
      return;
    }

    return next();
  });
}
