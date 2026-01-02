import type {
  AuthorityContext,
  AuthorityDecision,
  AuthorityRule,
  Scope,
} from "./types.js";
import { isOwner } from "./owner.js";
import type { RoleProvider } from "./roleProvider.js";

export class AuthorityResolver {
  constructor(private roleProvider: RoleProvider) {}

  async check(
    ctx: AuthorityContext,
    rule: AuthorityRule
  ): Promise<AuthorityDecision> {
    // OWNER همیشه عبور می‌کند
    if (isOwner(ctx.userId)) {
      return { allow: true };
    }

    const roles = await this.roleProvider.getRoles(ctx.userId);

    for (const r of roles) {
      if (!rule.roles.includes(r.role)) continue;

      for (const scopeType of rule.scope) {
        if (this.matchScope(r.scope, scopeType, ctx)) {
          return { allow: true };
        }
      }
    }

    return {
      allow: false,
      reason: "INSUFFICIENT_AUTHORITY",
    };
  }

  private matchScope(
    assigned: Scope,
    required: Scope["type"],
    ctx: AuthorityContext
  ): boolean {
    if (required === "GLOBAL") return assigned.type === "GLOBAL";

    if (required === "CHAT") {
      return (
        assigned.type === "CHAT" &&
        ctx.chatId !== undefined &&
        assigned.chatId === ctx.chatId
      );
    }

    return false;
  }
}
