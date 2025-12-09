import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";

/**
 * ارسال یک «صفحه» در پی‌وی که پیام قبلی را پاک می‌کند
 * و آیدی پیام جدید را در سشن نگه می‌دارد.
 */
export async function sendPvScreen(
  ctx: MyContext,
  text: string,
  keyboard?: InlineKeyboard
) {
  if (ctx.chat?.type === "private") {
    const lastId = (ctx.session as any).ui_last_message_id as
      | number
      | undefined;

    if (lastId) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, lastId);
      } catch {
        // اگر پیام قبلی پاک نشد، اهمیتی ندارد
      }
    }

    const msg = await ctx.reply(text, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });

    (ctx.session as any).ui_last_message_id = msg.message_id;
  } else {
    await ctx.reply(text, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
  }
}

function buildMainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🧭 مسیر های من", "paths:open")
    .row()
    .text("🗺 نقشه سریع من", "mymap:open")
    .row()
    .text("🚗 سواری ها", "veh:my")
    .row()
    .text("🚕 مسافر شوم", "ui:ride_hint");
}

export async function showMainMenu(ctx: MyContext) {
  await sendPvScreen(
    ctx,
    "<b>نقشه‌ی زنده‌ی اکلیس</b>\n\n" +
      "از اینجا می‌توانی مسیرت را ببینی، موقعیتت را چک کنی، " +
      "یا سراغ ماشین‌ها و مسافربری بروی.",
    buildMainMenu()
  );
}

export function registerUiFeature(bot: Bot<MyContext>) {
  // دستور /menu برای باز کردن منوی اصلی
  bot.command("menu", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await showMainMenu(ctx);
  });

  // اگر دوست داشتی یک متن خاص هم برای منو داشته باشی
  bot.hears("نقشه اکلیس", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await showMainMenu(ctx);
  });

  // دکمه بازگشت عمومی به منوی اصلی
  bot.callbackQuery("ui:home", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await showMainMenu(ctx);
  });

  // اگر کاربر روی «مسافر شوم» زد و هنوز سیستم مسافر را کامل نکرده باشیم
  bot.callbackQuery("ui:ride_hint", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await sendPvScreen(
      ctx,
      "برای سوار شدن به عنوان مسافر، می‌توانی در پی‌وی بنویسی:\n\n" +
        "<code>سوار ماشین بشم</code>\n\n" +
        "به‌زودی این منو هم تبدیل به یک صفحه کامل می‌شود.",
      new InlineKeyboard().text("🏠 منوی اصلی", "ui:home")
    );
  });
}
