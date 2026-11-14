export const GAME_NIGHT_IDLE = 4 * 60 * 60_000;
export const GAME_NIGHT_LENGTH = 16 * 60 * 60_000;
const TOUCH_INTERVAL = 60_000;

export function validNightSession(record) {
    const { createdAt, exp, idleUntil } = record;
    return Number.isSafeInteger(idleUntil) && idleUntil > createdAt && idleUntil <= exp
        && idleUntil >= Math.min(exp, createdAt + GAME_NIGHT_IDLE)
        && exp <= createdAt + GAME_NIGHT_LENGTH && !record.profile;
}

export function nextGameNightIdle(record, at) {
    if (record.idleUntil === undefined || record.idleUntil <= at || record.revoked) return null;
    const next = Math.min(record.exp, at + GAME_NIGHT_IDLE);
    return next > record.idleUntil && (next === record.exp || next - record.idleUntil >= TOUCH_INTERVAL) ? next : null;
}

export const nightIdleExpired = (record, at) => record.idleUntil !== undefined && record.idleUntil <= at;
