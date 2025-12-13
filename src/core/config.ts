import "dotenv/config";

export const BOT_TOKEN = process.env.BOT_TOKEN || "";
export const MASTER_ID = Number(process.env.MASTER_ID || 0);
export const SUPABASE_URL = process.env.SUPABASE_URL || "";
export const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
export const FLUX_PRICE_PER_PERCENT = Number(process.env.FLUX_PRICE_PER_PERCENT ?? 10); // هر 1٪ چند تا پول؟
export const BANK_GROUP_ID = process.env.BANK_GROUP_ID ? Number(process.env.BANK_GROUP_ID) : null;


if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required in environment");
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("[config] SUPABASE_URL or SUPABASE_KEY is missing – Supabase client will fail if used.");
}
