
import "dotenv/config";

export const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "";
export const MASTER_ID = Number(process.env.MASTER_ID ?? 0);

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required");
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("Supabase env vars not set. Database features will fail.");
}
