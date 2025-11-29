import express, { Request, Response } from "express";
import { bot } from "./core/bot";

// سرور اکسپرس برای وبهوک
const app = express();
app.use(express.json());

// آدرس وبهوک – برای امنیت، از توکن خود بات استفاده می‌کنیم
const webhookPath = `/webhook/${bot.token}`;

// هندلر وبهوک تلگرام
app.post(webhookPath, async (req: Request, res: Response) => {
  try {
    await bot.handleUpdate(req.body as any);
  } catch (err) {
    console.error("Error handling update:", err);
  }
  // همیشه 200 بدیم که تلگرام فکر نکنه fail شده
  res.sendStatus(200);
});

// یه روت ساده برای تست
app.get("/", (_req: Request, res: Response) => {
  res.send("Eclis Pathweaver bot is running.");
});

const PORT = Number(process.env.PORT) || 3000;

// استارت سرور + ست کردن وبهوک
app.listen(PORT, async () => {
  console.log(`HTTP server listening on port ${PORT}`);

  const baseUrl = process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    console.warn(
      "[webhook] WEBHOOK_BASE_URL ست نشده. وبهوک به‌صورت خودکار تنظیم نمیشه."
    );
    console.warn(
      "برای ست‌کردن خودکار، توی تنظیمات Render متغیر WEBHOOK_BASE_URL رو مثلاً برابر https://your-service.onrender.com بذار."
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
