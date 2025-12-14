import { Bot, InlineKeyboard } from "grammy";
import { MyContext } from "../../core/types";

/**
 * یک «صفحه» در پی‌وی می‌فرستد:
 * - اگر قبلاً صفحه‌ای فرستاده شده، آن را حذف می‌کند
 * - آیدی پیام جدید را در سشن نگه می‌دارد
 */
export async function sendPvScreen(
  ctx: MyContext,
  text: string,
  keyboard?: InlineKeyboard
) {
  // اگر پی‌وی نیست، فقط یک ریپلای معمولی بزن
  if (ctx.chat?.type !== "private") {
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    return;
  }

  const lastId = ctx.session.ui_last_message_id as
    | number
    | undefined;

  if (lastId) {
    try {
      await ctx.api.deleteMessage(ctx.chat.id, lastId);
    } catch {
      // اگر پیام قبلی پاک نشده بود (مثلاً خیلی قدیمی یا دستکاری شده) بی‌خیال
    }
  }

  const msg = await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });

  ctx.session.ui_last_message_id = msg.message_id;
}

/**
 * منوی اصلی اکلیس در پی‌وی
 * این همون «صفحه هاب» است
 */
function buildMainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🧭 مسیر های من", "paths:open")
    .row()
    .text("🗺 نقشه سریع من", "mymap:open")
    .row()
    // اینجا ورودی اصلی سیستم حمل‌ونقله
    .text("🚦 حمل و نقل", "ride:menu");
}

export async function showMainMenu(ctx: MyContext) {
  const text =
    "📜 <b>اکلیس · منوی راه‌ها</b>\n\n" +
    "از اینجا می‌توانی مسیرهایت را ببینی، جای فعلی‌ات را چک کنی " +
    "و وارد منوی <b>حمل و نقل</b> (ماشین، مسافر، سوخت‌گیری و بعداً مونت‌ها) شوی.";

  await sendPvScreen(ctx, text, buildMainMenu());
}

/**
 * رجیستر کردن UI عمومی
 */
export function registerUiFeature(bot: Bot<MyContext>) {
  // دکمه‌ی «🏠 منوی اصلی» اگر جایی ازش استفاده کردیم
  bot.callbackQuery("ui:home", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await showMainMenu(ctx);
  });

  // /menu برای برگرداندن بازیکن به منوی اصلی
  bot.command("menu", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await showMainMenu(ctx);
  });

  // اگر دوست داشتی در آینده با یک دکمه متنی هم برگردی:
  bot.hears("🏠 منوی اصلی", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await showMainMenu(ctx);
  });
}
