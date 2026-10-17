// Silent stand-in for livekit-client's loglevel-style logger (the only runtime import).
const noop = () => {};
const logger = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, log: noop, setLevel: noop, setDefaultLevel: noop, resetLevel: noop, enableAll: noop, disableAll: noop, getLevel: () => 5, levels: { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4, SILENT: 5 }, methodFactory: () => noop, getLogger: () => logger };
export function getLogger() { return logger; }
