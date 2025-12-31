export function createLogger(minLevel = 'info') {
    const order = ['debug', 'info', 'warn', 'error'];
    const minIdx = order.indexOf(minLevel);
    function shouldLog(level) {
        return order.indexOf(level) >= minIdx;
    }
    function out(level, msg, meta) {
        if (!shouldLog(level))
            return;
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
