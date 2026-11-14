export const GAME_NIGHT_IDLE = 4 * 60 * 60_000;
export const GAME_NIGHT_LENGTH = 16 * 60 * 60_000;

export function validNightSession(record) {
    const { createdAt, exp, idleUntil } = record;
    return Number.isSafeInteger(idleUntil) && idleUntil > createdAt && idleUntil <= exp
        && idleUntil >= Math.min(exp, createdAt + GAME_NIGHT_IDLE)
        && exp <= createdAt + GAME_NIGHT_LENGTH && !record.profile;
}
