import type { CommandDef } from './command.js';

export class CommandRegistry {
  private byName = new Map<string, CommandDef>();

  register(cmd: CommandDef): void {
    const names = [cmd.name, ...(cmd.aliases ?? [])].map((s) => s.trim().toLowerCase());
    for (const n of names) this.byName.set(n, cmd);
  }

  get(name: string): CommandDef | undefined {
    return this.byName.get(name.trim().toLowerCase());
  }

  list(): CommandDef[] {
    const uniq = new Map<string, CommandDef>();
    for (const c of this.byName.values()) uniq.set(c.name, c);
    return [...uniq.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
