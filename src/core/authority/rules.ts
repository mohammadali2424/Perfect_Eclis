import type { AuthorityRule } from "./types.js";

export const RULE_OWNER_ONLY: AuthorityRule = {
  roles: ["OWNER"],
  scope: ["GLOBAL"],
};

export const RULE_NAZER_GLOBAL: AuthorityRule = {
  roles: ["NAZER_GLOBAL"],
  scope: ["GLOBAL"],
};

export const RULE_NAZER_OR_OWNER: AuthorityRule = {
  roles: ["NAZER_GLOBAL"],
  scope: ["GLOBAL"],
};

export const RULE_ADMIN_OR_HIGHER: AuthorityRule = {
  roles: ["ADMIN_GLOBAL", "NAZER_GLOBAL"],
  scope: ["GLOBAL"],
};

export const RULE_CHAT_ADMIN: AuthorityRule = {
  roles: ["ADMIN_CHAT", "NAZER_CHAT"],
  scope: ["CHAT"],
};
