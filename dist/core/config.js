"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FLUX_PRICE_PER_PERCENT = exports.SUPABASE_KEY = exports.SUPABASE_URL = exports.MASTER_ID = exports.BOT_TOKEN = void 0;
require("dotenv/config");
exports.BOT_TOKEN = process.env.BOT_TOKEN || "";
exports.MASTER_ID = Number(process.env.MASTER_ID || 0);
exports.SUPABASE_URL = process.env.SUPABASE_URL || "";
exports.SUPABASE_KEY = process.env.SUPABASE_KEY || "";
exports.FLUX_PRICE_PER_PERCENT = Number((_a = process.env.FLUX_PRICE_PER_PERCENT) !== null && _a !== void 0 ? _a : 10); // هر 1٪ چند تا پول؟
if (!exports.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is required in environment");
}
if (!exports.SUPABASE_URL || !exports.SUPABASE_KEY) {
    console.warn("[config] SUPABASE_URL or SUPABASE_KEY is missing – Supabase client will fail if used.");
}
