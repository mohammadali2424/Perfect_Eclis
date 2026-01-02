import type { Db } from '../../core/storage/db.js';

/**
 * Placeholder. We'll wire the real Supabase client when we implement data layer.
 * Keeping this file isolated ensures future migration is one folder swap.
 */
export class SupabaseDb implements Db {
  constructor(private readonly url: string, private readonly serviceKey: string) {}

  async healthcheck(): Promise<boolean> {
    // TODO: implement real query
    return Boolean(this.url && this.serviceKey);
  }
}
