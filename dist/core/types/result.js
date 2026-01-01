export const ok = (value) => ({ ok: true, value });
export const err = (error, details) => ({ ok: false, error, details });
