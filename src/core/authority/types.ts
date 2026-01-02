export type Role =
  | "OWNER"
  | "NAZER_GLOBAL"
  | "NAZER_CHAT"
  | "ADMIN_GLOBAL"
  | "ADMIN_CHAT";

export type Scope =
  | { type: "GLOBAL" }
  | { type: "CHAT"; chatId: number };

export interface AuthorityContext {
  userId: number;
  chatId?: number;
}

export interface AuthorityRule {
  roles: Role[];
  scope: Scope["type"][];
}

export interface AuthorityDecision {
  allow: boolean;
  reason?: string;
}
