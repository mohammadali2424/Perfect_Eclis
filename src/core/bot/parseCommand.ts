// Supports:
// 1) "/ping ..." or "!ping ..."
// 2) "پینگ ...", "پنل", "ایکسپی +10 ..." (no prefix) if matches known aliases

export function parseCommand(
  text: string,
  aliases: string[],
): { name: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const isBang = trimmed.startsWith('!');
  const isSlash = trimmed.startsWith('/');

  // Case A: prefixed commands
  if (isBang || isSlash) {
    const withoutPrefix = trimmed.slice(1).trim();
    const parts = withoutPrefix.split(/\s+/g);
    const name = parts[0] ?? '';
    const args = parts.slice(1);
    if (!name) return null;
    return { name, args };
  }

  // Case B: no-prefix commands -> must match an alias
  // Use "longest alias wins" to support multi-word aliases like "افزودن ناظر"
  const lowered = trimmed.toLowerCase();
  const sorted = [...aliases].sort((a, b) => b.length - a.length);

  const matched = sorted.find((a) => {
    const al = a.trim().toLowerCase();
    return lowered === al || lowered.startsWith(al + ' ');
  });

  if (!matched) return null;

  const rest = trimmed.slice(matched.length).trim();
  const args = rest ? rest.split(/\s+/g) : [];
  return { name: matched, args };
}
