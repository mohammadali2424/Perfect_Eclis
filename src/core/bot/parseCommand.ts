// Persian-friendly: "!ایکسپی +10 شکار گرگ" OR "/xp +10" etc.

export function parseCommand(text: string): { name: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const isBang = trimmed.startsWith('!');
  const isSlash = trimmed.startsWith('/');
  if (!isBang && !isSlash) return null;

  const withoutPrefix = trimmed.slice(1).trim();
  const parts = withoutPrefix.split(/\s+/g);
  const name = parts[0] ?? '';
  const args = parts.slice(1);
  if (!name) return null;
  return { name, args };
}
