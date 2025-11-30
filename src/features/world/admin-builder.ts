import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";
import { MASTER_ID } from "../../core/config";

export function registerWorldAdminFeature(bot: Bot<MyContext>): void {
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

    if (exErr) {
      console.error("regions select error:", exErr);
      await ctx.reply("در بررسی Region مشکلی پیش آمد.");
      return;
    }

    let regionId: number;

    if (existing) {
      regionId = existing.id;
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
    }

    // سعی می‌کنیم پیام گروه را پاک کنیم (خود دستور)
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
        chat.id,
        "پنل جهان‌ساز برای این گروه به پی‌وی ارباب ارسال شد."
      );
    } catch (_e) {}

    // پی‌وی برای ارباب
    try {
      const kb = new InlineKeyboard()
        .text("➕ Spot جدید", `admin:addspot:${regionId}`)
        .row()
        .text("🔗 Edge جدید", `admin:addedge:${regionId}`)
        .row()
        .text("🗑 حذف / مدیریت", `admin:manage:${regionId}`);

      await ctx.api.sendMessage(
        MASTER_ID,
        "پنل ساده‌ی جهان‌ساز برای Region:\n\n" +
          `نام: ${title}\n` +
          `chat_id: ${chatId}\n` +
          `region_id: ${regionId}\n\n` +
          "فعلاً این دکمه‌ها اسکلت هستند و می‌شود بعداً منطق ساخت Spot/Edge و حذف را به آن‌ها وصل کرد.",
        { reply_markup: kb }
      );
    } catch (e) {
      console.error("send worldadmin panel to MASTER failed:", e);
    }
  });

  // فعلاً callbackهای admin:addspot / admin:addedge / admin:manage را فقط عبور می‌دهیم
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";

    if (
      data.startsWith("admin:addspot:") ||
      data.startsWith("admin:addedge:") ||
      data.startsWith("admin:manage:")
    ) {
      if (!ctx.from || ctx.from.id !== MASTER_ID) {
        await ctx.answerCallbackQuery({
          text: "🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون",
          show_alert: true,
        });
        return;
      }

      await ctx.answerCallbackQuery({
        text: "اسکلت پنل جهان‌ساز فعلاً آماده است؛ منطق کامل Spot/Edge بعداً اضافه می‌شود.",
        show_alert: true,
      });
      return;
    }

    return next();
  });
}
