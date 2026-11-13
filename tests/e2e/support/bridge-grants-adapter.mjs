// Bridge grants adapter. Tests talk to room grants only through this file.
//
// This is the real Worker module, hangout-worker/src/game-night-room-grants.mjs,
// running against the real Chess table class the Worker uses (GameNightChess).
// There is no stand-in here any more.
//
// What is still not real: the Worker has no route for grants (hook 2) and the
// table has no seat holds (hook 1). See BRIDGE-HOOKS.md. So this file gives the
// module the table port in-process:
//   status      reads the table checkpoint, as arcade-transport.mjs `load` does
//   seat        joins the real table with seat 'next' (hook 1 would move a hold)
//   releaseHold records the holder only (hook 1 would clear the table hold)
// Tables are kept as checkpoints in the same record shape the Worker stores.

import { GameNightChess } from '../../../hangout-worker/src/game-night-chess.mjs';
import {
    CLAIM_WINDOW, EXPIRED_COPY, GRANT_TTL, ROOM_GRANT_PREFIX, TABLE_FULL_COPY, createRoomGrants, grantHash, grantResponse
} from '../../../hangout-worker/src/game-night-room-grants.mjs';

export { createRoomGrants, grantResponse };
export const USING_STAND_IN = false;
export const HOLD_MS = CLAIM_WINDOW;
export const GRANT_TTL_MS = GRANT_TTL;
export const TABLE_FULL = TABLE_FULL_COPY;
export const EXPIRED_ERROR = EXPIRED_COPY;
export const GRANT_PREFIX = ROOM_GRANT_PREFIX;
export const hashGrant = grantHash;

const TABLE_PREFIX = 'game-night-match:';
const MATCH_TTL = 40 * 60_000;

function memoryStorage() {
    const data = new Map();
    return {
        data,
        async get(key) { return structuredClone(data.get(key)); },
        async put(key, record) { data.set(key, structuredClone(record)); },
        async delete(keys) { for (const key of [].concat(keys)) data.delete(key); },
        async list({ prefix, limit = Infinity }) {
            return new Map([...data].filter(([key]) => key.startsWith(prefix)).slice(0, limit).map(([key, record]) => [key, structuredClone(record)]));
        }
    };
}

// One room's worth of Worker state: grant rows plus Chess table checkpoints.
export function createChessBench({ now = () => Date.now() } = {}) {
    const storage = memoryStorage();
    const released = [];
    const key = scope => TABLE_PREFIX + scope.ref;
    const load = scope => {
        const record = storage.data.get(key(scope));
        if (!record || record.room !== scope.room || record.expiresAt <= now()) return null;
        return { record, game: GameNightChess.restore(record.chess) };
    };
    const save = (scope, record, game) => storage.data.set(key(scope), { ...record, chess: game.checkpoint() });

    const port = {
        async status(scope) {
            const found = load(scope);
            if (!found || found.game.checkpoint().id !== scope.match) return null;
            const { seats, match } = found.game.checkpoint();
            return { waiting: !match, host: seats.w, hostSeat: 'w', free: 2 - found.game.subjects.length };
        },
        async seat(scope, { subject, seat }) {
            const found = load(scope);
            if (!found || !found.game.join(subject, scope.match, now(), seat)) return null;
            save(scope, found.record, found.game);
            return found.game.seat(subject);
        },
        async releaseHold(_scope, holder) { released.push(holder); }
    };
    const grants = createRoomGrants({ storage, table: port });

    return {
        grants,
        released,
        // The host is seated by their own session, the way the `open` action does it.
        openTable({ room, ref, match, host }) {
            if (storage.data.has(TABLE_PREFIX + ref)) return false;
            storage.data.set(TABLE_PREFIX + ref, { room, expiresAt: now() + MATCH_TTL, chess: new GameNightChess(match, host).checkpoint() });
            return true;
        },
        closeTable({ ref }) { return storage.data.delete(TABLE_PREFIX + ref); },
        table(scope) {
            const found = load(scope);
            if (!found) return { present: false };
            const { id, seats, match } = found.game.checkpoint();
            return { present: true, id, status: match ? 'playing' : 'waiting', seats: { ...seats } };
        },
        grantRows: () => [...storage.data].filter(([name]) => name.startsWith(ROOM_GRANT_PREFIX)).map(([, record]) => structuredClone(record)),
        // Everything the module wrote, for "the value is never stored" checks.
        stored: () => JSON.stringify([...storage.data])
    };
}
