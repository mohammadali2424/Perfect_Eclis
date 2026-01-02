/**
 * DB Port (Hexagonal). Replace the adapter without touching domain/modules.
 *
 * Key rule: modules never import a concrete client (Supabase/Prisma/etc.).
 */
export interface Db {
  // Minimal query surface for now. We'll grow it when implementing repositories.
  healthcheck(): Promise<boolean>;
}
