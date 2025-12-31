export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function createLogger(minLevel: LogLevel = 'info'): Logger {
  const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const minIdx = order.indexOf(minLevel);

  function shouldLog(level: LogLevel) {
    return order.indexOf(level) >= minIdx;
  }

  function out(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
    if (!shouldLog(level)) return;
    const payload = meta ? ` ${JSON.stringify(meta)}` : '';
    // eslint-disable-next-line no-console
    console.log(`[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}${payload}`);
  }

  return {
    debug: (m, meta) => out('debug', m, meta),
    info: (m, meta) => out('info', m, meta),
    warn: (m, meta) => out('warn', m, meta),
    error: (m, meta) => out('error', m, meta)
  };
}
