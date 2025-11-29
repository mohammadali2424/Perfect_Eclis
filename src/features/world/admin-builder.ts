import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";

// کدهای داخلی برای خاندان‌ها
const CLANS: { id: string; label: string }[] = [
  { id: "stell", label: "🪽 Stellarieth" },
  { id: "walk", label: "⚡ Walker" },
  { id: "torr", label: "🔥 Torrentress" },
  { id: "necr", label: "🩸 Necroshade" },
];

// کمک‌کننده: ارسال پیام مدیریت‌شده در PV (پیام قبلی پاک می‌شود)
async function sendManagedPm(
  ctx: MyContext,
  text: string,
  keyboard?: InlineKeyboard
) {
  if (!ctx.from) return;
  const s = ctx.session as any;
  const lastId = s.__last_pm_id as number | undefined;

  if (lastId) {
    try {
      await ctx.api.deleteMessage(ctx.from.id, lastId);
    } catch {
      // مهم نیست، شاید پیام قبلی پاک شده باشه
    }
  }

  const msg = await ctx.api.sendMessage(ctx.from.id, text, {
    reply_markup: keyboard,
    parse_mode: "HTML",
  });

  s.__last_pm_id = msg.message_id;
}

// منوی اصلی پنل ادمین
function makeAdminMainKeyboard() {
  const kb = new InlineKeyboard()
    .text("➕ ثبت Region این گروه", "adm_region_new")
    .row()
    .text("🏙 ثبت Spot جدید", "adm_spot_new")
    .row()
    .text("🧵 ثبت Edge (مسیر)", "adm_edge_new")
    .row()
    .text("🧩 حذف / ویرایش (بعداً)", "adm_manage")
    .row()
    .text("📜 لیست مناطق بر اساس خاندان", "adm_list_clans");

  return kb;
}

// کیبورد انتخاب خاندان
function makeClanSelectKeyboard(actionPrefix: string) {
  const kb = new InlineKeyboard();
  for (const c of CLANS) {
    kb.text(c.label, `${actionPrefix}:${c.id}`).row();
  }
  return kb;
}

export function registerWorldAdminFeature(bot: Bot<MyContext>) {
  // دستور /aw (و /worldadmin) در گروه
 bot.command(["aw", "worldadmin"], async (ctx) => {
  if (!ctx.chat || !ctx.from) return;

  // فقط در گروه
  if (ctx.chat.type === "private") {
    await ctx.reply("این دستور باید داخل یک گروه اجرا شود.");
    return;
  }

  const s = ctx.session as any;

  // ثبت اطلاعات گروهی که پنل به آن متصل شده
  s.__admin_source_chat_id = ctx.chat.id;
  s.__admin_source_chat_title = ctx.chat.title ?? `Chat ${ctx.chat.id}`;

  // حذف پیام /aw
  try {
    await ctx.deleteMessage();
  } catch {}

  // باز کردن پنل داخل PV
  await sendManagedPm(
    ctx,
    "<b>پنل مدیریت جهان اکلیس فعال شد.</b>\n\n" +
      `گروه متصل: <b>${s.__admin_source_chat_title}</b>`,
    makeAdminMainKeyboard()
  );
});


  // بازگشت به منوی اصلی از هر جا
  bot.callbackQuery("adm_main", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendManagedPm(ctx, "بازگشت به منوی اصلی پنل ادمین:", makeAdminMainKeyboard());
  });

  // ➊ ثبت Region برای این گروه
  bot.callbackQuery("adm_region_new", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const s = ctx.session as any;
    const chatId = s.__admin_source_chat_id as number | undefined;

    if (!chatId) {
      await sendManagedPm(
        ctx,
        "هیچ گروهی به این پنل متصل نشده.\nدستور <code>/aw</code> را در گروه موردنظر بزن."
      );
      return;
    }

    // مرحله‌ی انتخاب خاندان
    await sendManagedPm(
      ctx,
      "این گروه متعلق به کدام خاندان است؟",
      makeClanSelectKeyboard("adm_region_clan")
    );
  });

  // انتخاب خاندان برای Region
  bot.callbackQuery(/^adm_region_clan:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const clanId = ctx.match![1];
    const clan = CLANS.find((c) => c.id === clanId);
    const s = ctx.session as any;
    const chatId = s.__admin_source_chat_id as number | undefined;

    if (!chatId) {
      await sendManagedPm(
        ctx,
        "هیچ گروهی به این پنل متصل نشده.\nدستور <code>/aw</code> را در گروه موردنظر بزن."
      );
      return;
    }

    const supabase = (ctx.services as any).supabase;

    // سعی می‌کنیم نام گروه را از سوپابیس ذخیره کنیم
    const title = s.__admin_source_chat_title || "Region";

    try {
      // اگر قبلاً Region برای این chat_id هست، تکراری نساز
      const { data: existing, error: exErr } = await supabase
        .from("eclis_regions")
        .select("*")
        .eq("chat_id", chatId)
        .maybeSingle();

      if (exErr) {
        console.error("supabase error (check region):", exErr);
      }

      if (existing) {
        // آپدیت خاندان
        const { error: updErr } = await supabase
          .from("eclis_regions")
          .update({ clan: clanId })
          .eq("id", existing.id);

        if (updErr) {
          console.error("supabase error (update region clan):", updErr);
          await sendManagedPm(
            ctx,
            "خطا در به‌روزرسانی Region. بعداً دوباره تلاش کن.",
            makeAdminMainKeyboard()
          );
          return;
        }

        await sendManagedPm(
          ctx,
          `خاندان این Region به <b>${clan?.label ?? clanId}</b> تغییر کرد.`,
          makeAdminMainKeyboard()
        );
        return;
      }

      // ساخت Region جدید
      const { error } = await supabase.from("eclis_regions").insert({
        chat_id: chatId,
        title,
        clan: clanId,
      });

      if (error) {
        console.error("supabase error (insert region):", error);
        await sendManagedPm(
          ctx,
          "خطا در ثبت Region جدید. بعداً دوباره تلاش کن.",
          makeAdminMainKeyboard()
        );
        return;
      }

      await sendManagedPm(
        ctx,
        `Region این گروه با خاندان <b>${clan?.label ?? clanId}</b> ثبت شد.`,
        makeAdminMainKeyboard()
      );
    } catch (e) {
      console.error("unexpected error (insert region):", e);
      await sendManagedPm(
        ctx,
        "یک خطای غیرمنتظره رخ داد.",
        makeAdminMainKeyboard()
      );
    }
  });

  // ➋ ثبت Spot جدید (برای Region همین گروه)
  bot.callbackQuery("adm_spot_new", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const s = ctx.session as any;
    const chatId = s.__admin_source_chat_id as number | undefined;
    if (!chatId) {
      await sendManagedPm(
        ctx,
        "هیچ گروهی به این پنل متصل نشده.\nدستور <code>/aw</code> را در گروه موردنظر بزن."
      );
      return;
    }

    const supabase = (ctx.services as any).supabase;

    try {
      // Region مربوط به این گروه
      const { data: region, error } = await supabase
        .from("eclis_regions")
        .select("*")
        .eq("chat_id", chatId)
        .maybeSingle();

      if (error) {
        console.error("supabase error (get region for spot):", error);
        await sendManagedPm(
          ctx,
          "خطا در دریافت Region این گروه.",
          makeAdminMainKeyboard()
        );
        return;
      }

      if (!region) {
        await sendManagedPm(
          ctx,
          "برای این گروه هنوز Region ثبت نشده.\nاول از گزینه «ثبت Region این گروه» استفاده کن.",
          makeAdminMainKeyboard()
        );
        return;
      }

      s.__admin_state = "create_spot";
      s.__current_region_id = region.id;

      await sendManagedPm(
        ctx,
        "👁‍🗨 نام Spot جدید را بنویس و ارسال کن (مثلاً: «میدان مرکزی»)."
      );
    } catch (e) {
      console.error("unexpected error (adm_spot_new):", e);
      await sendManagedPm(
        ctx,
        "یک خطای غیرمنتظره رخ داد.",
        makeAdminMainKeyboard()
      );
    }
  });

  // ➌ ثبت Edge (مسیر) بین Spotها
  bot.callbackQuery("adm_edge_new", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const s = ctx.session as any;
    const chatId = s.__admin_source_chat_id as number | undefined;
    if (!chatId) {
      await sendManagedPm(
        ctx,
        "هیچ گروهی به این پنل متصل نشده.\nدستور <code>/aw</code> را در گروه موردنظر بزن."
      );
      return;
    }

    const supabase = (ctx.services as any).supabase;

    try {
      // Region گروه
      const { data: region, error: regErr } = await supabase
        .from("eclis_regions")
        .select("*")
        .eq("chat_id", chatId)
        .maybeSingle();

      if (regErr) {
        console.error("supabase error (get region for edge):", regErr);
        await sendManagedPm(
          ctx,
          "خطا در دریافت Region این گروه.",
          makeAdminMainKeyboard()
        );
        return;
      }

      if (!region) {
        await sendManagedPm(
          ctx,
          "برای این گروه هنوز Region ثبت نشده.\nاول Region را ثبت کن.",
          makeAdminMainKeyboard()
        );
        return;
      }

      // Spotهای این Region
      const { data: spots, error: spotErr } = await supabase
        .from("eclis_spots")
        .select("*")
        .eq("region_id", region.id)
        .order("id", { ascending: true });

      if (spotErr) {
        console.error("supabase error (get spots for edge):", spotErr);
        await sendManagedPm(
          ctx,
          "خطا در دریافت Spotها.",
          makeAdminMainKeyboard()
        );
        return;
      }

      if (!spots || spots.length < 2) {
        await sendManagedPm(
          ctx,
          "برای ساخت Edge حداقل به دو Spot نیاز داری.",
          makeAdminMainKeyboard()
        );
        return;
      }

      // انتخاب Spot مبدا
      const kb = new InlineKeyboard();
      for (const sp of spots) {
        kb.text(sp.name ?? `Spot #${sp.id}`, `edge_src:${sp.id}`).row();
      }

      const s2 = ctx.session as any;
      s2.__current_region_id = region.id;
      s2.__admin_state = null;
      s2.__edge_src_spot_id = null;
      s2.__edge_dst_spot_id = null;

      await sendManagedPm(ctx, "🔻 Spot مبدا را انتخاب کن:", kb);
    } catch (e) {
      console.error("unexpected error (adm_edge_new):", e);
      await sendManagedPm(
        ctx,
        "یک خطای غیرمنتظره رخ داد.",
        makeAdminMainKeyboard()
      );
    }
  });

  // انتخاب Spot مبدا
  bot.callbackQuery(/^edge_src:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const srcId = Number(ctx.match![1]);
    const s = ctx.session as any;
    const regionId = s.__current_region_id as number | undefined;
    if (!regionId) {
      await sendManagedPm(
        ctx,
        "Region فعلی نامشخص است. دوباره از «ثبت Edge» شروع کن.",
        makeAdminMainKeyboard()
      );
      return;
    }

    const supabase = (ctx.services as any).supabase;

    try {
      const { data: spots, error } = await supabase
        .from("eclis_spots")
        .select("*")
        .eq("region_id", regionId)
        .order("id", { ascending: true });

      if (error) {
        console.error("supabase error (get spots for dst):", error);
        await sendManagedPm(
          ctx,
          "خطا در دریافت Spotها.",
          makeAdminMainKeyboard()
        );
        return;
      }

      if (!spots || spots.length < 2) {
        await sendManagedPm(
          ctx,
          "Spotهای کافی برای انتخاب مقصد وجود ندارد.",
          makeAdminMainKeyboard()
        );
        return;
      }

      s.__edge_src_spot_id = srcId;

      const kb = new InlineKeyboard();
      for (const sp of spots) {
        if (sp.id === srcId) continue; // نمی‌خوایم مبدا = مقصد بشه
        kb.text(sp.name ?? `Spot #${sp.id}`, `edge_dst:${sp.id}`).row();
      }

      await sendManagedPm(ctx, "🔻 حالا Spot مقصد را انتخاب کن:", kb);
    } catch (e) {
      console.error("unexpected error (edge_src):", e);
      await sendManagedPm(
        ctx,
        "یک خطای غیرمنتظره رخ داد.",
        makeAdminMainKeyboard()
      );
    }
  });

  // انتخاب Spot مقصد
  bot.callbackQuery(/^edge_dst:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const dstId = Number(ctx.match![1]);
    const s = ctx.session as any;
    s.__edge_dst_spot_id = dstId;
    s.__admin_state = "edge_time";

    await sendManagedPm(
      ctx,
      "⏱ زمان سفر بین این دو Spot را (به دقیقه) ارسال کن.\nمثال: <code>10</code>"
    );
  });

  // ➍ لیست مناطق بر اساس خاندان
  bot.callbackQuery("adm_list_clans", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendManagedPm(
      ctx,
      "خاندانی که می‌خواهی مناطقش را ببینی انتخاب کن:",
      makeClanSelectKeyboard("adm_list_clan")
    );
  });

  // انتخاب خاندان برای لیست منطقه‌ها
  bot.callbackQuery(/^adm_list_clan:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const clanId = ctx.match![1];
    const clan = CLANS.find((c) => c.id === clanId);
    const supabase = (ctx.services as any).supabase;

    try {
      const { data: regions, error } = await supabase
        .from("eclis_regions")
        .select("*")
        .eq("clan", clanId)
        .order("id", { ascending: true });

      if (error) {
        console.error("supabase error (list regions):", error);
        await sendManagedPm(
          ctx,
          "خطا در دریافت لیست مناطق.",
          makeAdminMainKeyboard()
        );
        return;
      }

      if (!regions || regions.length === 0) {
        await sendManagedPm(
          ctx,
          `برای خاندان <b>${clan?.label ?? clanId}</b> هنوز منطقه‌ای ثبت نشده.`,
          makeAdminMainKeyboard()
        );
        return;
      }

      const kb = new InlineKeyboard();
      for (const r of regions) {
        const title = r.title ?? `Region #${r.id}`;
        kb.text(title, `adm_region_info:${r.id}`).row();
      }

      await sendManagedPm(
        ctx,
        `📜 لیست Regionهای خاندان <b>${clan?.label ?? clanId}</b>:`,
        kb
      );
    } catch (e) {
      console.error("unexpected error (adm_list_clan):", e);
      await sendManagedPm(
        ctx,
        "یک خطای غیرمنتظره رخ داد.",
        makeAdminMainKeyboard()
      );
    }
  });

  // اطلاعات ساده یک Region (اسکلت برای آینده: حذف / ویرایش / مدیریت Spot و Edge)
  bot.callbackQuery(/^adm_region_info:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const regionId = Number(ctx.match![1]);
    const supabase = (ctx.services as any).supabase;

    try {
      const { data: region, error: regErr } = await supabase
        .from("eclis_regions")
        .select("*")
        .eq("id", regionId)
        .maybeSingle();

      if (regErr || !region) {
        console.error("supabase error (get region info):", regErr);
        await sendManagedPm(
          ctx,
          "خطا در دریافت اطلاعات Region.",
          makeAdminMainKeyboard()
        );
        return;
      }

      const { data: spots, error: spotErr } = await supabase
        .from("eclis_spots")
        .select("*")
        .eq("region_id", regionId);

      if (spotErr) {
        console.error("supabase error (get region spots):", spotErr);
      }

      const { data: edges, error: edgeErr } = await supabase
        .from("eclis_edges")
        .select("*")
        .eq("region_id", regionId);

      if (edgeErr) {
        console.error("supabase error (get region edges):", edgeErr);
      }

      const clan = CLANS.find((c) => c.id === region.clan);

      const text =
        `<b>Region:</b> ${region.title ?? `#${region.id}`}\n` +
        `<b>خاندان:</b> ${clan?.label ?? region.clan ?? "-"}\n` +
        `<b>Spot ها:</b> ${spots ? spots.length : 0}\n` +
        `<b>Edge ها:</b> ${edges ? edges.length : 0}\n\n` +
        "فعلاً فقط نمایش اطلاعاته. بعداً اینجا حذف / ویرایش اضافه می‌کنیم.";

      const kb = new InlineKeyboard().text("◀️ برگشت", "adm_list_clans").row().text("🏠 منوی اصلی", "adm_main");

      await sendManagedPm(ctx, text, kb);
    } catch (e) {
      console.error("unexpected error (adm_region_info):", e);
      await sendManagedPm(
        ctx,
        "یک خطای غیرمنتظره رخ داد.",
        makeAdminMainKeyboard()
      );
    }
  });

  // ➎ هندل ورودی‌های متنی در PV برای ساخت Spot / زمان Edge
  bot.on("message:text", async (ctx) => {
    if (!ctx.from || ctx.chat.type !== "private") return;

    const s = ctx.session as any;
    const state = s.__admin_state as string | undefined;

    if (!state) return; // کار ما نیست، بذار فیچرهای دیگه کار خودشونو بکنن

    const supabase = (ctx.services as any).supabase;
    const text = ctx.message.text.trim();

    // ساخت Spot جدید
    if (state === "create_spot") {
      const regionId = s.__current_region_id as number | undefined;
      if (!regionId) {
        s.__admin_state = null;
        await sendManagedPm(
          ctx,
          "Region مشخص نیست. دوباره از گزینه «ثبت Spot جدید» استفاده کن.",
          makeAdminMainKeyboard()
        );
        return;
      }

      try {
        const { error } = await supabase.from("eclis_spots").insert({
          region_id: regionId,
          name: text,
        });

        if (error) {
          console.error("supabase error (insert spot):", error);
          await sendManagedPm(
            ctx,
            "خطا در ثبت Spot جدید.",
            makeAdminMainKeyboard()
          );
          return;
        }

        s.__admin_state = null;
        s.__current_region_id = regionId;

        await sendManagedPm(
          ctx,
          `Spot جدید با نام «<b>${text}</b>» ثبت شد.`,
          makeAdminMainKeyboard()
        );
      } catch (e) {
        console.error("unexpected error (create_spot):", e);
        await sendManagedPm(
          ctx,
          "یک خطای غیرمنتظره رخ داد.",
          makeAdminMainKeyboard()
        );
      }

      return;
    }

    // تعیین زمان Edge
    if (state === "edge_time") {
      const srcId = s.__edge_src_spot_id as number | undefined;
      const dstId = s.__edge_dst_spot_id as number | undefined;
      const regionId = s.__current_region_id as number | undefined;

      if (!srcId || !dstId || !regionId) {
        s.__admin_state = null;
        await sendManagedPm(
          ctx,
          "اطلاعات Edge ناقص است. دوباره از «ثبت Edge» شروع کن.",
          makeAdminMainKeyboard()
        );
        return;
      }

      const minutes = Number(text);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        await sendManagedPm(
          ctx,
          "زمان باید یک عدد مثبت (به دقیقه) باشد. دوباره بفرست.",
        );
        return;
      }

      try {
        const { error } = await supabase.from("eclis_edges").insert({
          region_id: regionId,
          from_spot_id: srcId,
          to_spot_id: dstId,
          base_travel_minutes: minutes,
        });

        if (error) {
          console.error("supabase error (insert edge):", error);
          await sendManagedPm(
            ctx,
            "خطا در ثبت Edge جدید.",
            makeAdminMainKeyboard()
          );
          return;
        }

        s.__admin_state = null;
        s.__edge_src_spot_id = null;
        s.__edge_dst_spot_id = null;

        await sendManagedPm(
          ctx,
          `Edge بین Spot #${srcId} → Spot #${dstId} با زمان پایه ${minutes} دقیقه ثبت شد.`,
          makeAdminMainKeyboard()
        );
      } catch (e) {
        console.error("unexpected error (edge_time):", e);
        await sendManagedPm(
          ctx,
          "یک خطای غیرمنتظره رخ داد.",
          makeAdminMainKeyboard()
        );
      }

      return;
    }
  });

  // ➏ اسکلت حذف / ویرایش (بعداً تکمیل می‌کنیم)
  bot.callbackQuery("adm_manage", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendManagedPm(
      ctx,
      "بخش حذف / ویرایش بعداً تکمیل می‌شود.\nفعلاً فقط ساخت Region / Spot / Edge و لیست مناطق فعال است.",
      makeAdminMainKeyboard()
    );
  });
}
