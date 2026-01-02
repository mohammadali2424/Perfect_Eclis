import type { Role, Scope } from "../../core/authority/types.js";

export interface StoredRole {
  userId: number;
  role: Role;
  scope: Scope;
}

export interface AdminStore {
  getRoles(userId: number): Promise<StoredRole[]>;
  addRole(role: StoredRole): Promise<void>;
  removeRole(role: StoredRole): Promise<void>;
  removeAllRoles(userId: number): Promise<void>;
  listAll(): Promise<StoredRole[]>;
}

/**
 * نسخه موقت / پایدار در طول runtime
 * بعداً 1:1 با DB جایگزین می‌شود
 */
export class InMemoryAdminStore implements AdminStore {
  private roles: StoredRole[] = [];

  async getRoles(userId: number): Promise<StoredRole[]> {
    return this.roles.filter(r => r.userId === userId);
  }

  async addRole(role: StoredRole): Promise<void> {
    const exists = this.roles.some(
      r =>
        r.userId === role.userId &&
        r.role === role.role &&
        JSON.stringify(r.scope) === JSON.stringify(role.scope)
    );
    if (!exists) this.roles.push(role);
  }

  async removeRole(role: StoredRole): Promise<void> {
    this.roles = this.roles.filter(
      r =>
        !(
          r.userId === role.userId &&
          r.role === role.role &&
          JSON.stringify(r.scope) === JSON.stringify(role.scope)
        )
    );
  }

  async removeAllRoles(userId: number): Promise<void> {
    this.roles = this.roles.filter(r => r.userId !== userId);
  }

  async listAll(): Promise<StoredRole[]> {
    return [...this.roles];
  }
}
