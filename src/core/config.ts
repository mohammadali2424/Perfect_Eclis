export const BOT_TOKEN = process.env.BOT_TOKEN || "";
export const SUPABASE_URL = process.env.SUPABASE_URL || "";
export const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
export const MASTER_ID = Number(process.env.MASTER_ID || 0);

if (!BOT_TOKEN) {
  console.warn("[config] BOT_TOKEN is empty. Set it in your environment.");
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("[config] Supabase URL or KEY missing. DB features will fail until configured.");
}
