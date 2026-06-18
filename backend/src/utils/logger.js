const levels = ['info', 'warn', 'error'];
const noop = () => {};

function createLogger(module) {
  const logger = {};
  for (const level of levels) {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logger[level] = (message, data) => {
      const ts = new Date().toISOString();
      const extra = data !== undefined ? ` ${JSON.stringify(data)}` : '';
      fn(`[${ts}] [${module}] [${level.toUpperCase()}] ${message}${extra}`);
    };
  }
  return logger;
}

// Disable logging in production via LOG_LEVEL=error
const defaultLevel = process.env.LOG_LEVEL || 'info';
const levelRank = { info: 0, warn: 1, error: 2, none: 99 };
const minRank = levelRank[defaultLevel] ?? 0;

export function logger(module) {
  const raw = createLogger(module);
  if (minRank > levelRank.info) raw.info = noop;
  if (minRank > levelRank.warn) raw.warn = noop;
  return raw;
}