import type {
  RoleProvider,
  RoleAssignment,
} from "../../core/authority/roleProvider.js";
import type { Scope } from "../../core/authority/types.js";
import type { AdminStore } from "./adminStore.js";

export class AdminRoleProvider implements RoleProvider {
  constructor(private store: AdminStore) {}

  async getRoles(userId: number): Promise<RoleAssignment[]> {
    const stored = await this.store.getRoles(userId);

    return stored.map(r => ({
      role: r.role,
      scope: r.scope,
    }));
  }
}
