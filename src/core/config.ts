import "dotenv/config";

export const BOT_TOKEN = process.env.BOT_TOKEN || "";
export const MASTER_ID = Number(process.env.MASTER_ID || 0);
export const SUPABASE_URL = process.env.SUPABASE_URL || "";
export const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
export const FLUX_PRICE_PER_PERCENT = Number(process.env.FLUX_PRICE_PER_PERCENT ?? 10); // هر 1٪ چند تا پول؟

// Used to sign structured callback_data (cbq:v1:...).
// If not set, we fall back to BOT_TOKEN.
export const CBQ_SECRET = process.env.CBQ_SECRET || BOT_TOKEN;

// Outbox throttling (safe defaults for large group fleets)
export const OUTBOX_GROUP_MIN_INTERVAL_MS = Number(process.env.OUTBOX_GROUP_MIN_INTERVAL_MS ?? 3000);
export const OUTBOX_PRIVATE_MIN_INTERVAL_MS = Number(process.env.OUTBOX_PRIVATE_MIN_INTERVAL_MS ?? 900);
export const OUTBOX_GLOBAL_MAX_PER_SEC = Number(process.env.OUTBOX_GLOBAL_MAX_PER_SEC ?? 20);


if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required in environment");
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("[config] SUPABASE_URL or SUPABASE_KEY is missing – Supabase client will fail if used.");
}
