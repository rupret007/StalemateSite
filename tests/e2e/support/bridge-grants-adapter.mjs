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
//   hold        keeps a { holder, until } beside the table, as hook 1 would
//   seat        needs a live hold for `holder`, moves it to the guest session,
//               then joins the real table with seat 'next'
//   releaseHold clears that hold and records the holder
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
        // Durable Object semantics: key order, `limit` and `startAfter`.
        async list({ prefix, limit = Infinity, startAfter }) {
            const keys = [...data.keys()].filter(key => key.startsWith(prefix) && (startAfter === undefined || key > startAfter)).sort().slice(0, limit);
            return new Map(keys.map(key => [key, structuredClone(data.get(key))]));
        }
    };
}

// One room's worth of Worker state: grant rows plus Chess table checkpoints.
export function createChessBench({ now = () => Date.now() } = {}) {
    const storage = memoryStorage();
    const released = [];
    const holds = new Map();
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
        // Holds as hook 1 would keep them next to the checkpoint: holder -> until.
        async hold(scope, { holder, until, now: at }) {
            if (!load(scope) || holds.has(holder) || !(until > at)) return false;
            holds.set(holder, until);
            return true;
        },
        // Move the hold to the guest session, then that session's join takes the seat.
        async seat(scope, { subject, holder, seat, until, now: at }) {
            if (!(holds.get(holder) > at) || !(until > at)) return null;
            holds.delete(holder);
            holds.set(subject, until);
            const found = load(scope);
            if (!found || !found.game.join(subject, scope.match, now(), seat)) return null;
            holds.delete(subject);
            save(scope, found.record, found.game);
            return found.game.seat(subject);
        },
        async releaseHold(_scope, holder) { released.push(holder); holds.delete(holder); }
    };
    const grants = createRoomGrants({ storage, table: port });

    return {
        grants,
        released,
        tableHolds: () => [...holds].map(([holder, until]) => ({ holder, until })),
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
