import express, { Request, Response } from "express";
import { bot } from "./core/bot";
import { BOT_TOKEN } from "./core/config";

const app = express();
app.use(express.json());

// آدرس وبهوک – از خود BOT_TOKEN استفاده می‌کنیم، نه bot.botInfo یا چیز عجیب
const webhookPath = `/webhook/${BOT_TOKEN}`;

// هندلر وبهوک تلگرام
app.post(webhookPath, async (req: Request, res: Response) => {
  try {
    // اینجا دیگه init نمی‌زنیم، چون قبلاً یک‌بار در استارت انجام شده
    await bot.handleUpdate(req.body as any);
  } catch (err) {
    console.error("Error handling update:", err);
  }
  res.sendStatus(200);
});

// روت ساده برای تست
app.get("/", (_req: Request, res: Response) => {
  res.send("Eclis Pathweaver bot is running (webhook mode).");
});

const PORT = Number(process.env.PORT) || 3000;

// یک IIFE برای استارت سرور + init + setWebhook
(async () => {
  try {
    // این‌جا فقط یک‌بار bot.init رو انجام می‌دیم
    await bot.init();

    const baseUrl = process.env.WEBHOOK_BASE_URL;

    app.listen(PORT, async () => {
      console.log(`HTTP server listening on port ${PORT}`);

      if (!baseUrl) {
        console.warn(
          "[webhook] WEBHOOK_BASE_URL ست نشده. وبهوک به‌صورت خودکار تنظیم نمیشه."
        );
        console.warn(
          "توی تنظیمات Render متغیر WEBHOOK_BASE_URL رو مثلاً برابر https://your-service.onrender.com بذار."
        );
        return;
      }

      const url = `${baseUrl}${webhookPath}`;
      try {
        await bot.api.setWebhook(url);
        console.log("[webhook] Webhook set to:", url);
      } catch (err) {
        console.error("[webhook] Failed to set webhook:", err);
      }
    });
  } catch (err) {
    console.error("[fatal] Failed to init bot:", err);
  }
})();
