/**
 * Placeholder. We'll wire the real Supabase client when we implement data layer.
 * Keeping this file isolated ensures future migration is one folder swap.
 */
export class SupabaseDb {
    url;
    serviceKey;
    constructor(url, serviceKey) {
        this.url = url;
        this.serviceKey = serviceKey;
    }
    async healthcheck() {
        // TODO: implement real query
        return Boolean(this.url && this.serviceKey);
    }
}
