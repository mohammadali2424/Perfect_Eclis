import { AuthorityResolver } from "./resolver.js";
import { adminRoleProvider } from "../../modules/admin/index.js";

export const authority = new AuthorityResolver(adminRoleProvider);
