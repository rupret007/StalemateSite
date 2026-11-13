// WebJam room -> Game Night seat grants.
//
// The host attests who is in their WebJam room by registering SHA-256 hashes of
// one-time values the desktop app handed to each enrolled guest privately. A
// guest proves they hold a value by redeeming it. Only hashes are stored. The
// raw value is never stored, returned or logged, and this module never logs.
//
// The table port reserves an open side at registration and transfers the
// reservation to a scoped guest at redemption. The live adapter commits the
// reservation change and supplied grant rows atomically. A matching hashed
// attempt can recover a lost reply while the claim window is still open.

import { GAME_INVITE_UNAVAILABLE } from './game-night-invitations.mjs';

export const ROOM_GRANT_PREFIX = 'game-night-room-grant:';
export const GRANT_TTL = 2 * 60_000;
export const CLAIM_WINDOW = 60_000;
export const RECONNECT_WINDOW = 60_000;
export const GUEST_TTL = 2 * 60 * 60_000;
export const HASHES_PER_REQUEST = 16;
export const ROWS_PER_ROOM = 32;
const LIST_PAGE = 400;

// Same copy and status as game-night-invitations.mjs `unavailable()`.
export const EXPIRED_COPY = GAME_INVITE_UNAVAILABLE;
export const TABLE_FULL_COPY = "Table full, you're up next game";
const REGISTER_COPY = 'Open a game table with an available seat before seating your room.';
const HOST_COPY = 'You are hosting this table and already have a seat.';
const LIMIT_COPY = 'Game invitation allowance reached. Try again in a few minutes.';

const hashPattern = /^[a-f0-9]{64}$/;
export const validRoomGrantValue = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value);
const matchPattern = /^[a-zA-Z0-9-]{5,80}$/;
// Same shape gameGuestScope requires of a room ref. Checked before any row is stored.
const refPattern = /^[a-f0-9]{32}$/;
// Durable Object storage.delete accepts at most 128 keys per call.
const DELETE_CHUNK = 128;
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
    // Every row, a page at a time. Whether one hash is known is checked with `get`, not here.
    const rows = async () => {
        const all = [];
        for (let after; ;) {
            const page = [...await storage.list({ prefix: ROOM_GRANT_PREFIX, limit: LIST_PAGE, ...(after === undefined ? {} : { startAfter: after }) })];
            all.push(...page);
            if (page.length < LIST_PAGE) return all;
            after = page[page.length - 1][0];
        }
    };
    const sameTable = (left, right) => left.room === right.room && left.game === right.game && left.match === right.match;
    const live = (record, now) => record.kind === 'grant' && record.hold.until > now;
    // The same table, still run by the same host, waiting or playing.
    const present = (state, scope) => !!state && state.host === scope.host && typeof state.waiting === 'boolean';
    const waiting = (state, scope) => present(state, scope) && state.waiting === true && Number.isInteger(state.free);
    const tableState = async (scope) => {
        const state = await table.status(scope);
        return waiting(state, scope) ? state : null;
    };
    // Clears the hold only. The table and the host's seat are never touched.
    const release = async (record) => {
        if (record.kind === 'grant') await table.releaseHold?.(record.scope, record.hold.holder);
    };
    const drop = async (entries) => {
        for (const [, record] of entries) await release(record);
        const names = entries.map(([name]) => name);
        for (let index = 0; index < names.length; index += DELETE_CHUNK) {
            await storage.delete(names.slice(index, index + DELETE_CHUNK));
        }
        return entries.length;
    };
    const burn = (name, record) => storage.put(name, { kind: 'burned', hash: record.hash, scope: record.scope, until: record.until });

    async function sweepNow(now) {
        const stale = (await rows()).filter(([, record]) => record.until <= now);
        const released = stale.filter(([, record]) => record.kind === 'grant').length;
        return { expired: await drop(stale), released };
    }

    // `hostSubject` must come from the trusted host session, never from request data.
    function registerGrants({ room, match, game, hostSubject, hashes, now, ref = null, version }) {
        return serial(async () => {
            const refused = () => fail(403, 'unavailable', { error: REGISTER_COPY });
            if (!text(room) || !text(game) || !matchPattern.test(match || '') || !text(hostSubject) || !Number.isFinite(now)
                || !Array.isArray(hashes) || !hashes.length || hashes.length > HASHES_PER_REQUEST
                || !hashes.every(hash => hashPattern.test(hash || '')) || new Set(hashes).size !== hashes.length
                || typeof ref !== 'string' || !refPattern.test(ref)) return refused();
            const scope = { room, game, match, ref, host: hostSubject, ...(version === undefined ? {} : { version }) };
            // The host is seated by their own session before any grant exists.
            const state = await tableState(scope);
            if (!state) return refused();
            await sweepNow(now);
            const current = await rows();
            // A live grant, standby marker or burned tombstone keeps its hash out, wherever it sits in the list.
            const fresh = [];
            for (const hash of hashes) if (!await storage.get(key(hash))) fresh.push(hash);
            if (current.filter(([, record]) => record.scope.room === room).length + fresh.length > ROWS_PER_ROOM) {
                return fail(429, 'limit', { error: LIMIT_COPY });
            }
            const held = current.filter(([, record]) => sameTable(record.scope, scope) && live(record, now)).map(([, record]) => record.hold.slot);
            const until = now + GRANT_TTL;
            let granted = 0, standby = 0;
            for (const hash of fresh) {
                let slot = 1;
                while (held.includes(slot)) slot++;
                // One hold per seat, placed on the table now. The holder is the grant hash, never a value or a player.
                const row = { kind: 'grant', hash, scope, until, hold: { slot, holder: hash, until } };
                if (slot <= state.free && await table.hold(scope, { holder: hash, until, now, write: { [key(hash)]: row } })) {
                    held.push(slot);
                    if (!table.atomic) await storage.put(key(hash), row);
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
    function redeemGrant({ value, attempt, subject = null, now, version }) {
        return serial(async () => {
            if (!validRoomGrantValue(value) || !Number.isFinite(now) ||
                attempt !== undefined && !validRoomGrantValue(attempt)) return expired();
            const hash = await grantHash(value);
            const name = key(hash);
            const record = await storage.get(name);
            if (!record || !sameHash(record.hash, hash) || record.scope.version !== version || record.kind === 'burned') return expired();
            if (record.until <= now) {
                await drop([[name, record]]);
                return expired();
            }
            const { scope } = record;
            if (subject === scope.host) return fail(403, 'host', { error: HOST_COPY });
            const attemptHash = attempt === undefined ? null : await grantHash(attempt);
            const seen = await table.status(scope);
            if (record.kind === 'redeemed') {
                return present(seen, scope) && sameHash(record.attempt, attemptHash) && record.claimUntil > now
                    ? { ok: true, status: 200, body: record.access }
                    : expired();
            }
            // Standby first. The usual order on a two-seat table is: the granted guest
            // sits, the match starts, then the extra person taps. That is "table full",
            // not "expired", for as long as the same host's table exists.
            if (record.kind === 'standby') {
                if (present(seen, scope)) return tableFull();
                await drop([[name, record]]);
                return expired();
            }
            const state = waiting(seen, scope) ? seen : null;
            if (!state) {
                await drop([[name, record]]);
                return expired();
            }
            const sid = uuid();
            const claimUntil = now + CLAIM_WINDOW;
            const guest = { game: scope.game, match: scope.match, room: scope.room, ref: scope.ref, host: scope.host, nameSeed: seed() };
            const access = { scope: guest, sid, exp: now + GUEST_TTL };
            const tombstone = { kind: 'burned', hash, scope, until: record.until };
            const redeemed = attemptHash ? { ...tombstone, kind: 'redeemed', attempt: attemptHash, claimUntil, access } : tombstone;
            // The live adapter commits the moved hold and redemption together.
            const seat = sid === scope.host || state.free < 1 ? null
                : await table.seat(scope, { subject: sid, holder: record.hold.holder, seat: 'next', until: claimUntil, now, write: { [name]: redeemed } });
            const usable = !!seat && seat !== state.hostSeat;
            if (!usable) {
                await burn(name, record);
                await table.releaseHold?.(scope, record.hold.holder);
                if (seat) await table.releaseHold?.(scope, sid);
                return tableFull();
            }
            if (!table.atomic) await storage.put(name, redeemed);
            return { ok: true, status: 200, seat, claimUntil, body: access };
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
