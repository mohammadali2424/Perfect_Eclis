import 'dotenv/config';
export const env = {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    PORT: Number(process.env.PORT ?? 3000),
    BOT_TOKEN: process.env.BOT_TOKEN ?? '',
    BASE_URL: process.env.BASE_URL ?? '',
    WEBHOOK_PATH: process.env.WEBHOOK_PATH ?? '/telegram',
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET ?? '',
    // Current DB provider (Supabase on free plan)
    DB_PROVIDER: process.env.DB_PROVIDER ?? 'supabase',
    SUPABASE_URL: process.env.SUPABASE_URL ?? '',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
};
export function assertEnv() {
    const required = ['BOT_TOKEN'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
        throw new Error(`Missing env vars: ${missing.join(', ')}`);
    }
}
