import { InMemoryAdminStore } from "./adminStore.js";
import { AdminRoleProvider } from "./adminRoleProvider.js";

export const adminStore = new InMemoryAdminStore();
export const adminRoleProvider = new AdminRoleProvider(adminStore);
