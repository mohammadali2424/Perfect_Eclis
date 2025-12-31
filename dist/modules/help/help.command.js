export function makeHelpCommand(registry) {
    return {
        name: 'راهنما',
        aliases: ['help', 'کمک'],
        description: 'لیست دستورهای ربات',
        async execute() {
            const cmds = registry.list();
            const lines = cmds
                .map(c => `• !${c.name}${c.aliases?.length ? ` (${c.aliases.join(', ')})` : ''} — ${c.description}`)
                .sort();
            return ['📌 دستورها:', ...lines].join('\n');
        }
    };
}
