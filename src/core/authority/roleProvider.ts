import type { Role, Scope } from "./types.js";

export interface RoleAssignment {
  role: Role;
  scope: Scope;
}

export interface RoleProvider {
  getRoles(userId: number): Promise<RoleAssignment[]>;
}
