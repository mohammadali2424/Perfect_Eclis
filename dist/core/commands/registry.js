export class CommandRegistry {
    byName = new Map();
    register(cmd) {
        const names = [cmd.name, ...(cmd.aliases ?? [])].map((s) => s.trim().toLowerCase());
        for (const n of names)
            this.byName.set(n, cmd);
    }
    get(name) {
        return this.byName.get(name.trim().toLowerCase());
    }
    list() {
        const uniq = new Map();
        for (const c of this.byName.values())
            uniq.set(c.name, c);
        return [...uniq.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
}
