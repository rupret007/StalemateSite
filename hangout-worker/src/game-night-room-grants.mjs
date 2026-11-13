// WebJam room -> Game Night seat grants (bridge slice 1). No route wiring here.
//
// The host attests who is in their WebJam room by registering SHA-256 hashes of
// one-time values the desktop app handed to each enrolled guest privately. A
// guest proves they hold a value by redeeming it. Only hashes are stored. The
// raw value is never stored, returned or logged, and this module never logs.
//
// Storage and the table are injected:
//   storage: { get(key), put(key, value), delete(key | key[]), list({ prefix, limit }) -> Map }
//   table:   { status(scope) -> null | { waiting, host, free, hostSeat? },
//              seat(scope, { subject, holder, seat: 'next', until }) -> seat name | null,
//              releaseHold?(scope, holder) }
// `free` counts unoccupied non-host seats. Holds are never counted as occupied.
// See BRIDGE-HOOKS.md for the table hook this port maps onto.

export const ROOM_GRANT_PREFIX = 'game-night-room-grant:';
export const GRANT_TTL = 2 * 60_000;
export const CLAIM_WINDOW = 60_000;
export const RECONNECT_WINDOW = 60_000;
export const GUEST_TTL = 2 * 60 * 60_000;
export const HASHES_PER_REQUEST = 16;
export const ROWS_PER_ROOM = 32;
const ROW_CAP = 400;

// Same copy and status as game-night-invitations.mjs `unavailable()`.
export const EXPIRED_COPY = 'This invitation has expired, was used, or the game is no longer waiting for a guest. Ask your host for a new invite.';
export const TABLE_FULL_COPY = "Table full, you're up next game";
const REGISTER_COPY = 'Open a game table with an available seat before seating your room.';
const HOST_COPY = 'You are hosting this table and already have a seat.';
const LIMIT_COPY = 'Game invitation allowance reached. Try again in a few minutes.';

const hashPattern = /^[a-f0-9]{64}$/;
const valuePattern = /^[A-Za-z0-9_-]{32,128}$/;
const matchPattern = /^[a-zA-Z0-9-]{5,80}$/;
const text = value => typeof value === 'string' && !!value && value.length <= 200;

export async function grantHash(value) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Both inputs are fixed-length lowercase hex digests.
function sameHash(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    return difference === 0;
}

// Reconnect is data only: the transport decides when to release a seat.
export const reconnectDeadline = disconnectedAt => disconnectedAt + RECONNECT_WINDOW;
export const keepsSeat = ({ disconnectedAt, now }) => Number.isFinite(disconnectedAt) && Number.isFinite(now) && now < reconnectDeadline(disconnectedAt);

const fail = (status, reason, body) => ({ ok: false, status, reason, body });
const expired = () => fail(410, 'expired', { error: EXPIRED_COPY });
const tableFull = () => fail(409, 'table-full', { tableFull: true, message: TABLE_FULL_COPY });

// Only `body` ever reaches a client.
export const grantResponse = result => new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });

export function createRoomGrants({ storage, table, uuid = () => crypto.randomUUID(), seed = () => crypto.getRandomValues(new Uint32Array(1))[0] }) {
    let tail = Promise.resolve();
    // First come, first served, even when the injected storage yields.
    const serial = work => {
        const run = tail.then(work, work);
        tail = run.catch(() => {});
        return run;
    };
    const key = hash => ROOM_GRANT_PREFIX + hash;
    const rows = async () => [...await storage.list({ prefix: ROOM_GRANT_PREFIX, limit: ROW_CAP })];
    const sameTable = (left, right) => left.room === right.room && left.game === right.game && left.match === right.match;
    const live = (record, now) => record.kind === 'grant' && record.hold.until > now;
    const tableState = async (scope) => {
        const state = await table.status(scope);
        return state && state.waiting === true && state.host === scope.host && Number.isInteger(state.free) ? state : null;
    };
    // Clears the hold only. The table and the host's seat are never touched.
    const release = async (record) => {
        if (record.kind === 'grant') await table.releaseHold?.(record.scope, record.hold.holder);
    };
    const drop = async (entries) => {
        for (const [, record] of entries) await release(record);
        if (entries.length) await storage.delete(entries.map(([name]) => name));
        return entries.length;
    };
    const burn = async (name, record) => {
        await release(record);
        await storage.put(name, { kind: 'burned', hash: record.hash, scope: record.scope, until: record.until });
    };

    async function sweepNow(now) {
        const stale = (await rows()).filter(([, record]) => record.until <= now);
        const released = stale.filter(([, record]) => record.kind === 'grant').length;
        return { expired: await drop(stale), released };
    }

    // `hostSubject` must come from the trusted host session, never from request data.
    function registerGrants({ room, match, game, hostSubject, hashes, now, ref = null }) {
        return serial(async () => {
            const refused = () => fail(403, 'unavailable', { error: REGISTER_COPY });
            if (!text(room) || !text(game) || !matchPattern.test(match || '') || !text(hostSubject) || !Number.isFinite(now)
                || !Array.isArray(hashes) || !hashes.length || hashes.length > HASHES_PER_REQUEST
                || !hashes.every(hash => hashPattern.test(hash || '')) || new Set(hashes).size !== hashes.length
                || ref !== null && !text(ref)) return refused();
            const scope = { room, game, match, ref, host: hostSubject };
            // The host is seated by their own session before any grant exists.
            const state = await tableState(scope);
            if (!state) return refused();
            await sweepNow(now);
            const current = await rows();
            const known = new Set(current.map(([, record]) => record.hash));
            const fresh = hashes.filter(hash => !known.has(hash));
            if (current.filter(([, record]) => record.scope.room === room).length + fresh.length > ROWS_PER_ROOM) {
                return fail(429, 'limit', { error: LIMIT_COPY });
            }
            const held = current.filter(([, record]) => sameTable(record.scope, scope) && live(record, now)).map(([, record]) => record.hold.slot);
            const until = now + GRANT_TTL;
            let granted = 0, standby = 0;
            for (const hash of fresh) {
                let slot = 1;
                while (held.includes(slot)) slot++;
                if (slot <= state.free) {
                    held.push(slot);
                    // One hold per seat. The holder is the grant hash, never a value or a player.
                    await storage.put(key(hash), { kind: 'grant', hash, scope, until, hold: { slot, holder: hash, until } });
                    granted++;
                } else {
                    await storage.put(key(hash), { kind: 'standby', hash, scope, until });
                    standby++;
                }
            }
            return { ok: true, status: 200, body: { granted, standby, until } };
        });
    }

    // `subject` is the redeemer's existing session subject, or null for a fresh guest.
    function redeemGrant({ value, subject = null, now }) {
        return serial(async () => {
            if (typeof value !== 'string' || !valuePattern.test(value) || !Number.isFinite(now)) return expired();
            const hash = await grantHash(value);
            const name = key(hash);
            const record = await storage.get(name);
            if (!record || !sameHash(record.hash, hash) || record.kind === 'burned') return expired();
            if (record.until <= now) {
                await drop([[name, record]]);
                return expired();
            }
            const { scope } = record;
            if (subject === scope.host) return fail(403, 'host', { error: HOST_COPY });
            const state = await tableState(scope);
            if (!state) {
                await drop([[name, record]]);
                return expired();
            }
            if (record.kind === 'standby') return tableFull();
            const sid = uuid();
            // Burn first. A grant is never usable twice, whatever the table answers.
            await burn(name, record);
            if (sid === scope.host || state.free < 1) return tableFull();
            const seat = await table.seat(scope, { subject: sid, holder: record.hold.holder, seat: 'next', until: now + CLAIM_WINDOW });
            if (!seat || state.hostSeat !== undefined && seat === state.hostSeat) return tableFull();
            const guest = { game: scope.game, match: scope.match, room: scope.room, ref: scope.ref, host: scope.host, nameSeed: seed() };
            return { ok: true, status: 200, seat, claimUntil: now + CLAIM_WINDOW, body: { scope: guest, sid, exp: now + GUEST_TTL } };
        });
    }

    const sweep = now => serial(() => sweepNow(now));
    // Host left WebJam or the room closed.
    const revokeAll = room => serial(async () => ({ revoked: await drop((await rows()).filter(([, record]) => record.scope.room === room)) }));
    // Live holds for one table, for callers that must not hand a held seat to someone else.
    const holds = ({ room, game, match }, now) => serial(async () => (await rows())
        .filter(([, record]) => sameTable(record.scope, { room, game, match }) && live(record, now)).map(([, record]) => ({ ...record.hold })));

    return { registerGrants, redeemGrant, sweep, expire: sweep, revokeAll, holds };
}
