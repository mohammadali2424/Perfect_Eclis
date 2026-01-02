export type Ok<T> = { ok: true; value: T };
export type Err<E extends string = string> = { ok: false; error: E; details?: unknown };
export type Result<T, E extends string = string> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E extends string>(error: E, details?: unknown): Err<E> => ({ ok: false, error, details });
