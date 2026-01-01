export function createMemoryAdminStore(seed = []) {
    const set = new Set(seed);
    return {
        isAdmin(userId) {
            return set.has(userId);
        },
        addAdmin(userId) {
            set.add(userId);
        },
        removeAdmin(userId) {
            set.delete(userId);
        },
        listAdmins() {
            return Array.from(set.values()).sort((a, b) => a - b);
        },
    };
}
