function parseIdList(raw) {
    if (!raw)
        return new Set();
    return new Set(raw
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n)));
}
const OWNER_ID = Number(process.env.OWNER_TELEGRAM_ID || '');
const ADMIN_IDS = parseIdList(process.env.ADMIN_TELEGRAM_IDS);
export function isPrivileged(telegramUserId) {
    if (!telegramUserId)
        return false;
    if (Number.isFinite(OWNER_ID) && telegramUserId === OWNER_ID)
        return true;
    return ADMIN_IDS.has(telegramUserId);
}
