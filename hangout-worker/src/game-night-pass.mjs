const passPrefix = 'game-night-pass:';
const hashPattern = /^[a-f0-9]{64}$/;
const tablePattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

export const validGameNightPassHash = value => typeof value === 'string' && hashPattern.test(value);
export const validGameNightTableId = value => typeof value === 'string' && tablePattern.test(value);

export function gameNightPassRecord(access, passHash, version) {
    if (!validGameNightPassHash(passHash) || !validGameNightTableId(access.scope.tableId)) return {};
    return { [gameNightPassKey(access.scope.tableId, passHash)]: {
        scope: access.scope, sid: access.sid, exp: access.exp, version
    } };
}

export async function readGameNightPass(storage, tableId, pass) {
    if (!validGameNightTableId(tableId) || !validGameNightPassHash(pass)) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return storage.get(gameNightPassKey(tableId, hash));
}

function gameNightPassKey(tableId, hash) {
    return passPrefix + tableId + ':' + hash;
}

export async function sweepGameNightPasses(storage, now) {
    let startAfter;
    for (;;) {
        const page = await storage.list({ prefix: passPrefix, limit: 128, ...(startAfter ? { startAfter } : {}) });
        const expired = [...page].filter(([, record]) => record.exp <= now).map(([key]) => key);
        if (expired.length) await storage.delete(expired);
        if (page.size < 128) return;
        startAfter = [...page.keys()].at(-1);
    }
}
