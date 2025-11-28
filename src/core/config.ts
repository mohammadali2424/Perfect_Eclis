import dotenv from "dotenv";
dotenv.config();

export const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
export const BOT_OWNER_ID = Number(process.env.BOT_OWNER_ID ?? "0");
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
export const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "";
export const PORT = Number(process.env.PORT ?? "8080");

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set");
}
