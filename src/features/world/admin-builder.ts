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
      await ctx.reply("در بررسی Region مشکلی پیش آمد.");
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
        await ctx.reply("در ثبت Region جدید خطایی رخ داد.");
        return;
      }

      regionId = inserted.id;
      clanName = inserted.clan_name || null;
    }

    // حذف پیام دستور در گروه
    try {
      if (ctx.message) {
        await ctx.deleteMessage();
      }
    } catch (e) {
      console.warn("delete worldadmin message failed:", e);
    }

    // پیام کوتاه در گروه
    try {
      await ctx.api.sendMessage(
        chatId,
        "پنل جهان‌ساز برای این گروه به پی‌وی ارباب ارسال شد."
      );
    } catch (_e) {}

    // ارسال پنل به پی‌وی ارباب
    try {
      const kb = regionPanelKeyboard(regionId, !!clanName);

      await ctx.api.sendMessage(
        MASTER_ID,
        "پنل جهان‌ساز برای Region:\n\n" +
          `نام: ${title}\n` +
          `chat_id: ${chatId}\n` +
          `region_id: ${regionId}\n` +
          `خاندان: ${clanName || "هنوز تعیین نشده"}\n\n` +
          "از دکمه‌های زیر برای ساخت Spot و Edge و مدیریت استفاده کن.",
        { reply_markup: kb }
      );
    } catch (e) {
      console.error("send worldadmin panel to MASTER failed:", e);
    }
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

    await ctx.reply("کدام خاندان/فیلتر را برای نمایش مناطق می‌خواهی؟", {
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

      await ctx.reply("Spot جدید ساخته شد ✅");
      return;
    }

    // زمان سفر Edge
    if (mode === "add_edge_time" && regionId && fromSpotId && toSpotId) {
      const seconds = Number(text);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        await ctx.reply("زمان سفر باید یک عدد مثبت (بر حسب ثانیه) باشد.");
        return;
      }

      const { error: insErr } = await supabase.from("edges").insert({
        from_spot_id: fromSpotId,
        to_spot_id: toSpotId,
        travel_seconds: Math.floor(seconds),
      });

      ctx.session.admin_mode = undefined;
      ctx.session.admin_region_id = undefined;
      ctx.session.admin_from_spot_id = undefined;
      ctx.session.admin_to_spot_id = undefined;

      if (insErr) {
        console.error("insert edge error:", insErr);
        await ctx.reply("در ساخت Edge جدید مشکلی پیش آمد.");
        return;
      }

      await ctx.reply("Edge جدید ساخته شد ✅");
      return;
    }

    return next();
  });

  // همه callbackهای admin
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";

    if (data.startsWith("admin:") && (!ctx.from || ctx.from.id !== MASTER_ID)) {
      await ctx.answerCallbackQuery({
        text: "🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون",
        show_alert: true,
      });
      return;
    }

    const { supabase } = ctx.services;

    // لیست Regionها بر اساس خاندان/همه
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
        await ctx.reply("در خواندن لیست مناطق خطایی رخ داد.");
        return;
      }

      if (!regions || regions.length === 0) {
        await ctx.reply("هیچ Region با این فیلتر پیدا نشد.");
        return;
      }

      const kb = new InlineKeyboard();
      for (const r of regions) {
        const name = r.title || `Region #${r.id}`;
        kb.text(name, `admin:openregion:${r.id}`).row();
      }

      await ctx.reply("یکی از Regionها را انتخاب کن:", {
        reply_markup: kb,
      });

      return;
    }

    // باز کردن پنل Region از پی‌وی
    if (data.startsWith("admin:openregion:")) {
      await ctx.answerCallbackQuery();
      const regionId = Number(data.split(":")[2]);

      const { data: region, error } = await supabase
        .from("regions")
        .select("*")
        .eq("id", regionId)
        .maybeSingle();

      if (error || !region) {
        await ctx.reply("این Region در دیتابیس پیدا نشد.");
        return;
      }

      const kb = regionPanelKeyboard(region.id, !!region.clan_name);

      await ctx.reply(
        "پنل Region:\n\n" +
          `نام: ${region.title}\n` +
          `chat_id: ${region.telegram_chat_id}\n` +
          `region_id: ${region.id}\n` +
          `خاندان: ${region.clan_name || "هنوز تعیین نشده"}`,
        { reply_markup: kb }
      );
      return;
    }

    // ست/تغییر خاندان Region
    if (data.startsWith("admin:setclan:")) {
      const regionId = Number(data.split(":")[2]);

      const kb = new InlineKeyboard();
      for (const k of clanKeys()) {
        kb.text(clanLabel(k), `admin:setclan2:${regionId}:${k}`).row();
      }

      await ctx.answerCallbackQuery();
      await ctx.reply("این Region زیرمجموعه کدام خاندان/بی‌طرف است؟", {
        reply_markup: kb,
      });

      return;
    }

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

      await ctx.reply(
        `خاندان این Region روی ${
          label || "Neutral / بی‌طرف"
        } تنظیم شد.`
      );
      return;
    }

    // Spot جدید
    if (data.startsWith("admin:addspot:")) {
      await ctx.answerCallbackQuery();
      const regionId = Number(data.split(":")[2]);

      ctx.session.admin_mode = "add_spot";
      ctx.session.admin_region_id = regionId;

      await ctx.reply(
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
        await ctx.reply("در خواندن Spotها مشکلی پیش آمد.");
        return;
      }

      if (!spots || spots.length === 0) {
        await ctx.reply("برای این Region هنوز هیچ Spotی تعریف نشده.");
        return;
      }

      let text = "Spotهای این Region:\n\n";
      for (const s of spots) {
        text += `#${s.id} — ${s.title}\n`;
      }

      await ctx.reply(text);
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
        await ctx.reply(
          "برای این Region هنوز Spotی تعریف نشده که بتوان مسیری ساخت."
        );
        return;
      }

      const kb = new InlineKeyboard();
      for (const s of spots) {
        kb.text(s.title, `admin:edge_from:${regionId}:${s.id}`).row();
      }

      await ctx.reply("مبدا Edge را (Spot مبدأ) انتخاب کن:", {
        reply_markup: kb,
      });
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

      await ctx.reply(
        "خاندان/بی‌طرف/همه برای Region مقصد را انتخاب کن:",
        { reply_markup: kb }
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

      let query = supabase.from("regions").select("*").order("id", { ascending: true });

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
        await ctx.reply("در خواندن Regionهای مقصد مشکلی پیش آمد.");
        return;
      }

      if (!regions || regions.length === 0) {
        await ctx.reply("Region مناسبی برای این فیلتر پیدا نشد.");
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

      await ctx.reply("Region مقصد را انتخاب کن:", { reply_markup: kb });
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
        await ctx.reply(
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

      await ctx.reply("Spot مقصد را انتخاب کن:", { reply_markup: kb });
      return;
    }

    // Edge جدید (مرحله ۵: دریافت زمان سفر)
    if (data.startsWith("admin:edge_to:")) {
      await ctx.answerCallbackQuery();
      const parts = data.split(":");
      const fromRegionId = Number(parts[2]);
      const fromSpotId = Number(parts[3]);
      const toRegionId = Number(parts[4]);
      const toSpotId = Number(parts[5]);

      ctx.session.admin_mode = "add_edge_time";
      ctx.session.admin_region_id = fromRegionId;
      ctx.session.admin_from_spot_id = fromSpotId;
      ctx.session.admin_to_spot_id = toSpotId;

      await ctx.reply(
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
        await ctx.reply("برای این Region Spotی پیدا نشد.");
        return;
      }

      const spotMap = new Map<number, any>();
      for (const s of spots) spotMap.set(s.id, s);

      const { data: edges, error: edgeErr } = await supabase
        .from("edges")
        .select("*");

      if (edgeErr || !edges || edges.length === 0) {
        await ctx.reply("هیچ Edgeی در جهان تعریف نشده.");
        return;
      }

      let text = "Edgeهای مرتبط با Spotهای این Region:\n\n";
      for (const e of edges) {
        const fromSpot = spotMap.get(e.from_spot_id);
        const toSpot = spotMap.get(e.to_spot_id);
        if (!fromSpot && !toSpot) continue;

        text += `#${e.id} — ${fromSpot?.title || e.from_spot_id} → ${
          toSpot?.title || e.to_spot_id
        } (${e.travel_seconds}ث)\n`;
      }

      if (text.trim() === "Edgeهای مرتبط با Spotهای این Region:") {
        await ctx.reply("هیچ Edgeی مرتبط با Spotهای این Region پیدا نشد.");
        return;
      }

      await ctx.reply(text);
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
        await ctx.reply("برای این Region Spotی وجود ندارد که حذف شود.");
        return;
      }

      const kb = new InlineKeyboard();
      for (const s of spots) {
        kb.text(`🗑 ${s.title}`, `admin:delspot2:${regionId}:${s.id}`).row();
      }

      await ctx.reply("کدام Spot را می‌خواهی حذف کنی؟", {
        reply_markup: kb,
      });
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
      await ctx.reply(
        "Spot انتخاب‌شده حذف شد ✅ (اگر Edgeهای متصل بوده، به‌خاطر FK احتمالاً آن‌ها هم حذف شده‌اند)."
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
        await ctx.reply("برای این Region Spotی وجود ندارد.");
        return;
      }

      const spotMap = new Map<number, any>();
      for (const s of spots) spotMap.set(s.id, s);

      const { data: edges, error: edgeErr } = await supabase
        .from("edges")
        .select("*");

      if (edgeErr || !edges || edges.length === 0) {
        await ctx.reply("هیچ Edgeی برای حذف وجود ندارد.");
        return;
      }

      const kb = new InlineKeyboard();
      for (const e of edges) {
        const fromSpot = spotMap.get(e.from_spot_id);
        const toSpot = spotMap.get(e.to_spot_id);
        if (!fromSpot && !toSpot) continue;

        const label = `${fromSpot?.title || e.from_spot_id} → ${
          toSpot?.title || e.to_spot_id
        } (${e.travel_seconds}ث)`;
        kb.text(label, `admin:deledge2:${e.id}`).row();
      }

      await ctx.reply("کدام Edge را می‌خواهی حذف کنی؟", {
        reply_markup: kb,
      });
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
      await ctx.reply("Edge انتخاب‌شده حذف شد ✅");
      return;
    }

    return next();
  });
}
