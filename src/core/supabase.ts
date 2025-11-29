import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("[config] Supabase URL or KEY missing. Set SUPABASE_URL and SUPABASE_KEY env vars.");
  throw new Error("Supabase URL or KEY missing");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
