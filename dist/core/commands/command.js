export function createRegistry() {
    const map = new Map();
    const add = (k, v) => map.set(k.toLowerCase(), v);
    return {
        register(cmd) {
            add(cmd.name, cmd);
            for (const a of cmd.aliases ?? [])
                add(a, cmd);
        },
        get(name) {
            return map.get(name.toLowerCase()) ?? null;
        },
        list() {
            // return unique primary commands
            const uniq = new Map();
            for (const v of map.values())
                uniq.set(v.name, v);
            return Array.from(uniq.values()).sort((a, b) => a.name.localeCompare(b.name));
        },
    };
}
