// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CLAIM_WINDOW, EXPIRED_COPY, GRANT_TTL, GUEST_TTL, HASHES_PER_REQUEST, RECONNECT_WINDOW, ROOM_GRANT_PREFIX, TABLE_FULL_COPY,
    createRoomGrants, grantHash, grantResponse, keepsSeat, reconnectDeadline
} from '../src/game-night-room-grants.mjs';
import { createGameNightTable } from '../src/game-night-table.mjs';
import { gameInvitationRequest } from '../src/game-night-invitations.mjs';

const ROOM = '#game-abcdefxabcdef', OTHER_ROOM = '#game-123456x123456';
const MATCH = 'match-0001', HOST = 'host-session-0001', REF = 'a'.repeat(32);
const NOW = Date.parse('2026-11-12T21:00:00Z');
// Test-only stand-ins for the one-time values the desktop app would make.
const value = index => `test-value-${index}-`.padEnd(43, 'x');

class Match {
    constructor(id) { this.id = id; }
    checkpoint() { return { id: this.id }; }
    static restore(record) { return new Match(record.id); }
}

// The real table class behind the port BRIDGE-HOOKS.md describes.
function realTable(sides, options = {}) {
    const Table = createGameNightTable({ name: 'test', version: 1, Match, sides, finished: () => false, project: () => ({}), ...options });
    let game = new Table(MATCH, HOST);
    const released = [];
    // Table-side holds as hook 1 keeps them: holder -> until. Only a live hold can be moved or seated.
    const holdsByHolder = new Map();
    const liveHold = (holder, now) => holdsByHolder.has(holder) && holdsByHolder.get(holder) > now;
    const moves = [];
    return {
        released,
        holdsByHolder,
        moves,
        get game() { return game; },
        close() { game = null; },
        // A walk-in outside the grants: a stranger link or Play tap before hook 1 blocks it.
        join: subject => game.join(subject, MATCH, NOW, 'next'),
        port: {
            status: async scope => game && game.view(HOST, NOW).id === scope.match ? {
                waiting: game.view(HOST, NOW).waiting, host: game.checkpoint().seats[sides[0]], hostSeat: sides[0],
                free: sides.length - game.subjects.length
            } : null,
            hold: async (scope, { holder, until, now }) => {
                if (!game || holdsByHolder.has(holder) || !(until > now)) return false;
                holdsByHolder.set(holder, until);
                return true;
            },
            // Move the hold to the guest session, then let that session's join take the seat.
            async seat(scope, { subject, holder, seat, until, now }) {
                if (!liveHold(holder, now) || !(until > now)) return null;
                holdsByHolder.delete(holder);
                holdsByHolder.set(subject, until);
                moves.push({ holder, subject, until });
                if (!game.join(subject, scope.match, NOW, seat)) return null;
                holdsByHolder.delete(subject);
                return game.seat(subject);
            },
            releaseHold: async (scope, holder) => { released.push(holder); holdsByHolder.delete(holder); }
        }
    };
}

function memoryStorage() {
    const data = new Map();
    const pause = () => new Promise(resolve => setTimeout(resolve, 0));
    return {
        data,
        async get(key) { await pause(); return structuredClone(data.get(key)); },
        async put(key, record) { await pause(); data.set(key, structuredClone(record)); },
        async delete(keys) {
            await pause();
            const list = [].concat(keys);
            if (list.length > 128) throw new Error('storage.delete accepts at most 128 keys');
            for (const key of list) data.delete(key);
        },
        // Durable Object semantics: key order, `limit` and `startAfter` are honoured.
        async list({ prefix, limit = Infinity, startAfter }) {
            await pause();
            const keys = [...data.keys()].filter(key => key.startsWith(prefix) && (startAfter === undefined || key > startAfter)).sort().slice(0, limit);
            return new Map(keys.map(key => [key, structuredClone(data.get(key))]));
        }
    };
}

let storage, table, grants, sids;
function setup(sides = ['w', 'b'], options) {
    storage = memoryStorage();
    table = realTable(sides, options);
    sids = 0;
    grants = createRoomGrants({ storage, table: table.port, uuid: () => `guest-session-${++sids}`, seed: () => 7 });
}
const hashes = indexes => Promise.all(indexes.map(index => grantHash(value(index))));
const register = async (indexes, extra = {}) => grants.registerGrants({
    room: ROOM, match: MATCH, game: 'chess', hostSubject: HOST, hashes: await hashes(indexes), now: NOW, ref: REF, ...extra
});
const kinds = () => [...storage.data.values()].map(record => record.kind).sort();

beforeEach(() => setup());

describe('registerGrants', () => {
    it('lets only the seated host register', async () => {
        expect((await register([1], { hostSubject: 'someone-else' })).status).toBe(403);
        expect((await register([1], { hostSubject: '' })).status).toBe(403);
        expect(storage.data.size).toBe(0);
        expect(await register([1])).toEqual({ ok: true, status: 200, body: { granted: 1, standby: 0, until: NOW + GRANT_TTL } });
    });

    it('requires the host to be seated at a waiting table first', async () => {
        table.close();
        expect((await register([1])).status).toBe(403);
        setup();
        table.join('walk-in');
        expect(table.game.view(HOST, NOW).waiting).toBe(false);
        expect((await register([1])).status).toBe(403);
        expect(storage.data.size).toBe(0);
    });

    it('never creates more grants than free seats, with one hold per seat', async () => {
        setup(['a', 'b', 'c', 'd'], { manualStart: true, minSeats: 2 });
        const result = await register([1, 2, 3, 4, 5]);
        expect(result.body).toMatchObject({ granted: 3, standby: 2 });
        const held = await grants.holds({ room: ROOM, game: 'chess', match: MATCH }, NOW);
        expect(held.map(hold => hold.slot).sort()).toEqual([1, 2, 3]);
        expect(new Set(held.map(hold => hold.holder)).size).toBe(3);
        expect(held.every(hold => hold.until === NOW + GRANT_TTL)).toBe(true);
        // A later request cannot stack more holds on the same seats.
        expect((await register([6])).body).toMatchObject({ granted: 0, standby: 1 });
        // Holds are not occupancy: the table is unchanged and still waiting.
        expect(table.game.subjects).toEqual([HOST]);
        expect(table.game.view(HOST, NOW).waiting).toBe(true);
    });

    it('rejects a missing or non-32-hex ref before storing', async () => {
        for (const ref of [null, undefined, '', 'not-a-ref', 'r'.repeat(32), 'R'.repeat(32), 'a'.repeat(31), 'a'.repeat(33)]) {
            expect((await register([1], { ref })).status, String(ref)).toBe(403);
        }
        expect(storage.data.size).toBe(0);
        expect(table.holdsByHolder.size).toBe(0);
    });

    it('rejects malformed, duplicate and oversized hash lists', async () => {
        const [hash] = await hashes([1]);
        for (const list of [[], ['nope'], [value(1)], [hash, hash], 'x', Array(HASHES_PER_REQUEST + 1).fill(hash)]) {
            const result = await grants.registerGrants({ room: ROOM, match: MATCH, game: 'chess', hostSubject: HOST, hashes: list, now: NOW });
            expect(result.status).toBe(403);
        }
        expect(storage.data.size).toBe(0);
    });

    it('stores hashes only, never the one-time value', async () => {
        await register([1, 2]);
        await grants.redeemGrant({ value: value(1), now: NOW + 1 });
        const stored = JSON.stringify([...storage.data]);
        expect(stored).not.toContain(value(1));
        expect(stored).not.toContain(value(2));
        expect(stored).toContain(await grantHash(value(1)));
        expect([...storage.data.keys()].every(key => /^game-night-room-grant:[a-f0-9]{64}$/.test(key))).toBe(true);
    });
});

describe('redeemGrant', () => {
    it('seats the guest in the next seat, burns the grant and returns the guest mint data', async () => {
        await register([1]);
        const result = await grants.redeemGrant({ value: value(1), now: NOW + 5 });
        expect(result).toEqual({
            ok: true, status: 200, seat: 'b', claimUntil: NOW + 5 + CLAIM_WINDOW,
            body: { scope: { game: 'chess', match: MATCH, room: ROOM, ref: REF, host: HOST, nameSeed: 7 }, sid: 'guest-session-1', exp: NOW + 5 + GUEST_TTL }
        });
        expect(JSON.stringify(result)).not.toContain(value(1));
        expect(table.game.seat('guest-session-1')).toBe('b');
        expect(table.game.seat(HOST)).toBe('w');
        expect(kinds()).toEqual(['burned']);
        expect(await grants.holds({ room: ROOM, game: 'chess', match: MATCH }, NOW + 5)).toEqual([]);
    });

    it('answers a replay with the same 410 shape as a spent stranger invitation', async () => {
        await register([1]);
        await grants.redeemGrant({ value: value(1), now: NOW + 5 });
        const replay = await grants.redeemGrant({ value: value(1), now: NOW + 6 });
        expect(replay).toEqual({ ok: false, status: 410, reason: 'expired', body: { error: EXPIRED_COPY } });
        expect(table.game.subjects).toEqual([HOST, 'guest-session-1']);

        const lobby = { env: { HANGOUT_BETA_MODE: 'protected', HANGOUT_GAME_NIGHT_GUESTS: '1' }, state: { storage: { get: async () => undefined } } };
        const existing = await gameInvitationRequest(lobby, 'details', { code: 'a'.repeat(32) });
        const ours = grantResponse(replay);
        expect(ours.status).toBe(existing.status);
        expect(await ours.json()).toEqual(await existing.json());
    });

    it('answers unknown and malformed values like an expired grant', async () => {
        await register([1]);
        for (const attempt of [value(9), 'short', '', null, undefined, 42, value(1) + '!']) {
            expect((await grants.redeemGrant({ value: attempt, now: NOW })).status).toBe(410);
        }
        expect(kinds()).toEqual(['grant']);
    });

    it('rejects the host session and leaves the grant for the guest', async () => {
        await register([1]);
        const result = await grants.redeemGrant({ value: value(1), subject: HOST, now: NOW + 1 });
        expect(result).toMatchObject({ ok: false, status: 403, reason: 'host' });
        expect(table.game.subjects).toEqual([HOST]);
        expect((await grants.redeemGrant({ value: value(1), now: NOW + 2 })).ok).toBe(true);
    });

    it('never gives a guest seat 0, even when the table port misbehaves', async () => {
        setup(['a', 'b', 'c'], { manualStart: true, minSeats: 2 });
        await register([1, 2]);
        const first = await grants.redeemGrant({ value: value(1), now: NOW + 1 });
        const second = await grants.redeemGrant({ value: value(2), now: NOW + 2 });
        expect([first.seat, second.seat]).toEqual(['b', 'c']);
        expect(table.game.checkpoint().seats.a).toBe(HOST);

        setup();
        const seat = vi.fn(async () => 'w');
        grants = createRoomGrants({ storage, table: { ...table.port, seat } });
        await register([3]);
        const result = await grants.redeemGrant({ value: value(3), now: NOW + 1 });
        expect(seat).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ seat: 'next' }));
        expect(result.ok).toBe(false);
        expect(result.seat).toBeUndefined();
    });

    it('rejects an expired grant, releases its hold and leaves the table waiting', async () => {
        await register([1]);
        const hash = await grantHash(value(1));
        const result = await grants.redeemGrant({ value: value(1), now: NOW + GRANT_TTL });
        expect(result).toMatchObject({ ok: false, status: 410, reason: 'expired' });
        expect(table.released).toEqual([hash]);
        expect(storage.data.size).toBe(0);
        expect(table.game.subjects).toEqual([HOST]);
        expect(table.game.view(HOST, NOW).waiting).toBe(true);
        // The freed seat can be granted again.
        expect((await register([2], { now: NOW + GRANT_TTL })).body.granted).toBe(1);
    });

    it('tells the third person the table is full', async () => {
        await register([1, 2]);
        expect((await grants.redeemGrant({ value: value(1), now: NOW + 1 })).ok).toBe(true);
        setup();
        await register([1, 2]);
        const third = await grants.redeemGrant({ value: value(2), now: NOW + 1 });
        expect(third).toEqual({ ok: false, status: 409, reason: 'table-full', body: { tableFull: true, message: TABLE_FULL_COPY } });
        expect(TABLE_FULL_COPY).toBe("Table full, you're up next game");
        expect(table.game.subjects).toEqual([HOST]);
        // The seat holder is unaffected by the standby attempt.
        expect((await grants.redeemGrant({ value: value(1), now: NOW + 2 })).seat).toBe('b');
    });

    it('keeps the table-full line for the third person after the match has started', async () => {
        await register([1, 2]);
        expect((await grants.redeemGrant({ value: value(1), now: NOW + 1 })).ok).toBe(true);
        expect(table.game.view(HOST, NOW).waiting).toBe(false);
        for (const now of [NOW + 2, NOW + 3]) {
            const third = await grants.redeemGrant({ value: value(2), now });
            expect(third).toEqual({ ok: false, status: 409, reason: 'table-full', body: { tableFull: true, message: TABLE_FULL_COPY } });
        }
        // A closed table and an expired marker still read as expired.
        expect((await grants.redeemGrant({ value: value(2), now: NOW + GRANT_TTL })).status).toBe(410);
        setup();
        await register([1, 2]);
        table.close();
        expect((await grants.redeemGrant({ value: value(2), now: NOW + 1 })).status).toBe(410);
    });

    it('places the hold at register and moves it to the guest in seat, without releasing it first', async () => {
        await register([1]);
        const hash = await grantHash(value(1));
        expect([...table.holdsByHolder]).toEqual([[hash, NOW + GRANT_TTL]]);
        const result = await grants.redeemGrant({ value: value(1), now: NOW + 5 });
        expect(result).toMatchObject({ ok: true, seat: 'b' });
        expect(table.moves).toEqual([{ holder: hash, subject: 'guest-session-1', until: NOW + 5 + CLAIM_WINDOW }]);
        expect(table.released).toEqual([]);
        expect(table.holdsByHolder.size).toBe(0);
        expect(kinds()).toEqual(['burned']);
    });

    it('leaves the grant and its hold alone when seat throws, and burns on a definite no', async () => {
        await register([1]);
        const hash = await grantHash(value(1));
        const seat = table.port.seat;
        let fail = true;
        grants = createRoomGrants({ storage, table: { ...table.port, seat(...args) { if (fail) throw new Error('storage hiccup'); return seat.apply(table.port, args); } }, uuid: () => `guest-session-${++sids}`, seed: () => 7 });
        await expect(grants.redeemGrant({ value: value(1), now: NOW + 1 })).rejects.toThrow('storage hiccup');
        expect(kinds()).toEqual(['grant']);
        expect(table.holdsByHolder.has(hash)).toBe(true);
        fail = false;
        expect(await grants.redeemGrant({ value: value(1), now: NOW + 2 })).toMatchObject({ ok: true, seat: 'b' });

        // The table lost the hold (hook 1 expired it): a definite no burns and frees.
        setup();
        await register([2]);
        const lost = await grantHash(value(2));
        table.holdsByHolder.delete(lost);
        expect(await grants.redeemGrant({ value: value(2), now: NOW + 1 })).toMatchObject({ status: 409, reason: 'table-full' });
        expect(kinds()).toEqual(['burned']);
        expect(table.released).toEqual([lost]);
        expect(table.game.subjects).toEqual([HOST]);
    });

    it('gives a surplus guest table-full, not expired, after the granted guest sits at a real two-seat table', async () => {
        const [granted, surplus] = await register([1, 2]).then(() => [value(1), value(2)]);
        expect((await grants.redeemGrant({ value: granted, now: NOW + 1 })).seat).toBe('b');
        // Same table object, no reset: the match has started.
        expect(table.game.view(HOST, NOW).waiting).toBe(false);
        expect(await grants.redeemGrant({ value: surplus, now: NOW + 2 }))
            .toEqual({ ok: false, status: 409, reason: 'table-full', body: { tableFull: true, message: TABLE_FULL_COPY } });
        expect(table.game.subjects).toEqual([HOST, 'guest-session-1']);
        expect(kinds()).toEqual(['burned', 'standby']);
    });

    it('lets exactly one of two concurrent redeems win the last seat', async () => {
        setup(['a', 'b', 'c'], { manualStart: true, minSeats: 2 });
        await register([1, 2]);
        // A walk-in takes one seat outside the grants, so two grants now chase one seat.
        expect(table.join('walk-in')).toBe(true);
        const results = await Promise.all([
            grants.redeemGrant({ value: value(1), now: NOW + 1 }), grants.redeemGrant({ value: value(2), now: NOW + 1 })
        ]);
        expect(results.filter(result => result.ok)).toHaveLength(1);
        expect(results.find(result => !result.ok)).toMatchObject({ status: 409, reason: 'table-full' });
        expect(results[0].ok).toBe(true);
        expect(table.game.subjects).toEqual([HOST, 'walk-in', 'guest-session-1']);
        expect(kinds()).toEqual(['burned', 'burned']);
    });

    it('gives the same value to two concurrent callers only once', async () => {
        await register([1]);
        const results = await Promise.all([1, 2, 3].map(() => grants.redeemGrant({ value: value(1), now: NOW + 1 })));
        expect(results.map(result => result.status).sort()).toEqual([200, 410, 410]);
    });

    it('expires every grant for a table that started or closed', async () => {
        await register([1]);
        table.join('walk-in');
        expect((await grants.redeemGrant({ value: value(1), now: NOW + 1 })).status).toBe(410);
        expect(storage.data.size).toBe(0);
        setup();
        await register([1]);
        table.close();
        expect((await grants.redeemGrant({ value: value(1), now: NOW + 1 })).status).toBe(410);
    });
});

describe('sweep and revokeAll', () => {
    it('sweeps expired grants, standby markers and burned rows without touching the table', async () => {
        await register([1, 2]);
        expect(await grants.sweep(NOW + GRANT_TTL - 1)).toEqual({ expired: 0, released: 0 });
        expect(await grants.expire(NOW + GRANT_TTL)).toEqual({ expired: 2, released: 1 });
        expect(storage.data.size).toBe(0);
        expect(table.released).toEqual([await grantHash(value(1))]);
        expect(table.game.subjects).toEqual([HOST]);
        expect(table.game.view(HOST, NOW).waiting).toBe(true);
    });

    it('revokes every unclaimed grant in one room when the host leaves', async () => {
        await register([1, 2]);
        await register([3], { room: OTHER_ROOM });
        expect(await grants.revokeAll(ROOM)).toEqual({ revoked: 2 });
        expect([...storage.data.values()].map(record => record.scope.room)).toEqual([OTHER_ROOM]);
        expect((await grants.redeemGrant({ value: value(1), now: NOW + 1 })).status).toBe(410);
        expect((await grants.redeemGrant({ value: value(2), now: NOW + 1 })).status).toBe(410);
        expect(table.game.view(HOST, NOW).waiting).toBe(true);
        expect((await grants.redeemGrant({ value: value(3), now: NOW + 1 })).ok).toBe(true);
    });
});

describe('more rows than one list page', () => {
    // Keys that sort before any real grant hash in this file, so real rows land past the first page.
    const filler = (count, room, extra = {}) => {
        for (let index = 0; index < count; index++) {
            const hash = '0'.repeat(60) + index.toString(16).padStart(4, '0');
            storage.data.set(ROOM_GRANT_PREFIX + hash, { kind: 'burned', hash, scope: { room, game: 'chess', match: MATCH, ref: null, host: HOST }, until: NOW + GRANT_TTL, ...extra });
        }
    };

    it('keeps a burned hash from being registered again past the first page', async () => {
        // Three seats, so the table is still waiting (and registrable) after the first guest sits.
        setup(['a', 'b', 'c'], { manualStart: true, minSeats: 2 });
        filler(450, OTHER_ROOM);
        expect((await grantHash(value(1))) > '0'.repeat(60) + 'ffff').toBe(true);
        await register([1]);
        expect((await grants.redeemGrant({ value: value(1), now: NOW + 1 })).ok).toBe(true);
        expect((await register([1], { now: NOW + 2 })).body).toMatchObject({ granted: 0, standby: 0 });
        expect(storage.data.get(ROOM_GRANT_PREFIX + await grantHash(value(1))).kind).toBe('burned');
        expect((await grants.redeemGrant({ value: value(1), now: NOW + 3 })).status).toBe(410);
    });

    it('applies the room cap to rows past the first page', async () => {
        filler(420, OTHER_ROOM);
        for (let index = 0; index < 32; index++) {
            const hash = 'f'.repeat(60) + index.toString(16).padStart(4, '0');
            storage.data.set(ROOM_GRANT_PREFIX + hash, { kind: 'standby', hash, scope: { room: ROOM, game: 'chess', match: MATCH, ref: REF, host: HOST }, until: NOW + GRANT_TTL });
        }
        expect((await register([1])).status).toBe(429);
    });

    it('sweeps and revokes rows past the first page', async () => {
        const sizes = [];
        const realDelete = storage.delete.bind(storage);
        storage.delete = async (keys) => {
            const list = [].concat(keys);
            sizes.push(list.length);
            return realDelete(keys);
        };
        filler(450, OTHER_ROOM, { until: NOW });
        expect(await grants.sweep(NOW)).toEqual({ expired: 450, released: 0 });
        expect(sizes.length).toBeGreaterThan(1);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(128);
        expect(sizes.reduce((sum, count) => sum + count, 0)).toBe(450);
        sizes.length = 0;
        filler(450, OTHER_ROOM);
        await register([1]);
        expect(await grants.revokeAll(OTHER_ROOM)).toEqual({ revoked: 450 });
        expect(Math.max(...sizes)).toBeLessThanOrEqual(128);
        expect(sizes.reduce((sum, count) => sum + count, 0)).toBe(450);
        expect(kinds()).toEqual(['grant']);
    });

    it('refuses a storage.delete of more than 128 keys', async () => {
        const keys = Array.from({ length: 129 }, (_, index) => `game-night-room-grant:${index}`);
        await expect(storage.delete(keys)).rejects.toThrow(/128/);
        expect(storage.data.size).toBe(0);
    });
});

describe('logging and reconnect data', () => {
    it('never writes to the console', async () => {
        const spies = ['log', 'info', 'warn', 'error', 'debug'].map(method => vi.spyOn(console, method).mockImplementation(() => {}));
        await register([1, 2]);
        await grants.redeemGrant({ value: value(1), now: NOW + 1 });
        await grants.redeemGrant({ value: value(1), now: NOW + 2 });
        await grants.redeemGrant({ value: value(2), subject: HOST, now: NOW + 2 });
        await grants.sweep(NOW + GRANT_TTL);
        await grants.revokeAll(ROOM);
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });

    it('keeps a disconnected guest seat for 60 seconds', () => {
        expect(RECONNECT_WINDOW).toBe(60_000);
        expect(CLAIM_WINDOW).toBe(60_000);
        expect(GRANT_TTL).toBe(120_000);
        expect(reconnectDeadline(NOW)).toBe(NOW + 60_000);
        expect(keepsSeat({ disconnectedAt: NOW, now: NOW + 59_999 })).toBe(true);
        expect(keepsSeat({ disconnectedAt: NOW, now: NOW + 60_000 })).toBe(false);
        expect(keepsSeat({ disconnectedAt: undefined, now: NOW })).toBe(false);
    });

    it('uses one storage prefix', () => expect(ROOM_GRANT_PREFIX).toBe('game-night-room-grant:'));
});
