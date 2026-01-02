export function isOwner(userId: number): boolean {
  const owner = Number(process.env.OWNER_TELEGRAM_ID || 0);
  return owner > 0 && userId === owner;
}
