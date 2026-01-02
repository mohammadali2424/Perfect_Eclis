export function createMemoryAdminStore(seed: number[] = []) {
  const set = new Set<number>(seed);

  return {
    isAdmin(userId: number) {
      return set.has(userId);
    },
    addAdmin(userId: number) {
      set.add(userId);
    },
    removeAdmin(userId: number) {
      set.delete(userId);
    },
    listAdmins() {
      return Array.from(set.values()).sort((a, b) => a - b);
    },
  };
}
