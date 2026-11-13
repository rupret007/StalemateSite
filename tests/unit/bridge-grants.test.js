// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    EXPIRED_ERROR, GRANT_TTL_MS, HOLD_MS, TABLE_FULL, USING_STAND_IN, createChessBench, grantResponse, hashGrant
} from '../e2e/support/bridge-grants-adapter.mjs';
import * as worker from '../../hangout-worker/src/game-night-room-grants.mjs';

const ROOM = '#game-abcdefxabcdef';
const table = { room: ROOM, ref: 'a'.repeat(32), match: 'match-chess-0001', host: 'host-session-0001' };
const scope = { room: table.room, ref: table.ref, game: 'chess', match: table.match };
const fresh = () => randomBytes(16).toString('hex');

function clock(start = Date.parse('2026-11-12T21:00:00Z')) {
    let at = start;
    return { now: () => at, add: ms => { at += ms; } };
}

function open(time = clock()) {
    const bench = createChessBench({ now: time.now });
    expect(bench.openTable(table)).toBe(true);
    return { bench, grants: bench.grants, time };
}

async function register(grants, time, values, extra = {}) {
    return grants.registerGrants({
        room: table.room, ref: table.ref, match: table.match, game: 'chess', hostSubject: table.host,
        hashes: await Promise.all(values.map(hashGrant)), now: time.now(), ...extra
    });
}

describe('bridge grants on the real Worker module and the real Chess table', () => {
    it('uses the Worker module, not a stand-in', () => {
        expect(USING_STAND_IN).toBe(false);
        const source = readFileSync(new URL('../e2e/support/bridge-grants-adapter.mjs', import.meta.url), 'utf8');
        expect(source).toContain("from '../../../hangout-worker/src/game-night-room-grants.mjs'");
        expect(source).toContain("from '../../../hangout-worker/src/game-night-chess.mjs'");
        expect(source).not.toMatch(/function (registerGrants|redeemGrant|sweep|revokeAll)\b/);
        expect(EXPIRED_ERROR).toBe(worker.EXPIRED_COPY);
        expect(TABLE_FULL).toBe(worker.TABLE_FULL_COPY);
        expect(TABLE_FULL).toBe("Table full, you're up next game");
        expect([HOLD_MS, GRANT_TTL_MS]).toEqual([worker.CLAIM_WINDOW, worker.GRANT_TTL]);
        expect(hashGrant).toBe(worker.grantHash);
    });

    it('seats the host from their own session before any grant exists', async () => {
        const { bench, grants, time } = open();
        expect(bench.table(scope)).toEqual({ present: true, id: table.match, status: 'waiting', seats: { w: table.host, b: null } });
        expect(bench.grantRows()).toEqual([]);
        // No table, or someone else's table, means no grants.
        const none = createChessBench({ now: time.now });
        expect((await register(none.grants, time, [fresh()])).status).toBe(403);
        expect((await register(grants, time, [fresh()], { hostSubject: 'someone-else' })).status).toBe(403);
        expect(bench.grantRows()).toEqual([]);
    });

    it('stores hashes only, with one hold on the one free Chess seat', async () => {
        const { bench, grants, time } = open();
        const value = fresh();
        // A raw value in place of a hash is refused.
        expect((await grants.registerGrants({ ...scope, hostSubject: table.host, hashes: [value], now: time.now() })).status).toBe(403);
        expect(bench.grantRows()).toEqual([]);
        const issued = await register(grants, time, [value]);
        expect(issued).toEqual({ ok: true, status: 200, body: { granted: 1, standby: 0, until: time.now() + GRANT_TTL_MS } });
        expect(bench.stored().includes(value)).toBe(false);
        expect(bench.stored().includes(await hashGrant(value))).toBe(true);
        expect(await grants.holds(scope, time.now())).toEqual([{ slot: 1, holder: await hashGrant(value), until: time.now() + GRANT_TTL_MS }]);
        // A hold is not a seat: the real table is unchanged.
        expect(bench.table(scope)).toMatchObject({ status: 'waiting', seats: { w: table.host, b: null } });
    });

    it('seats the guest as Black and returns the existing 410 shape on replay', async () => {
        const { bench, grants, time } = open();
        const value = fresh();
        await register(grants, time, [value]);
        // The hold sits on the table from register until seat moves it to the guest.
        expect(bench.tableHolds()).toEqual([{ holder: await hashGrant(value), until: time.now() + GRANT_TTL_MS }]);
        const first = await grants.redeemGrant({ value, now: time.now() });
        expect(first).toMatchObject({ ok: true, status: 200, seat: 'b' });
        expect(bench.released).toEqual([]);
        expect(bench.tableHolds()).toEqual([]);
        expect(bench.table(scope)).toMatchObject({ status: 'playing', seats: { w: table.host, b: first.body.sid } });
        expect(first.body.scope).toMatchObject({ game: 'chess', match: table.match, room: table.room, ref: table.ref, host: table.host });
        const replay = await grants.redeemGrant({ value, now: time.now() });
        expect(replay.status).toBe(410);
        const response = grantResponse(replay);
        expect(response.status).toBe(410);
        expect(await response.json()).toEqual({ error: EXPIRED_ERROR });
        expect(bench.stored().includes(value)).toBe(false);
    });

    it('refuses a host session without burning the guest grant', async () => {
        const { bench, grants, time } = open();
        const value = fresh();
        await register(grants, time, [value]);
        const hostTry = await grants.redeemGrant({ value, subject: table.host, now: time.now() });
        expect(hostTry.status).toBe(403);
        expect(bench.grantRows().map(row => row.kind)).toEqual(['grant']);
        expect(bench.table(scope).seats).toEqual({ w: table.host, b: null });
        const guest = await grants.redeemGrant({ value, now: time.now() });
        expect(guest).toMatchObject({ status: 200, seat: 'b' });
        expect(bench.table(scope).seats.w).toBe(table.host);
    });

    it('releases an expired hold and leaves the host table waiting', async () => {
        const { bench, grants, time } = open();
        const value = fresh();
        await register(grants, time, [value]);
        time.add(GRANT_TTL_MS - 1);
        expect(await grants.sweep(time.now())).toEqual({ expired: 0, released: 0 });
        time.add(1);
        expect(await grants.sweep(time.now())).toEqual({ expired: 1, released: 1 });
        expect(bench.released).toEqual([await hashGrant(value)]);
        expect(await grants.holds(scope, time.now())).toEqual([]);
        expect(bench.table(scope)).toEqual({ present: true, id: table.match, status: 'waiting', seats: { w: table.host, b: null } });
        const late = await grants.redeemGrant({ value, now: time.now() });
        expect(late.status).toBe(410);
        expect(late.body).toEqual({ error: EXPIRED_ERROR });
        // The freed seat can be granted again.
        expect((await register(grants, time, [fresh()])).body).toMatchObject({ granted: 1, standby: 0 });
    });

    it('tells the extra person the table is full, before and after the seat is taken', async () => {
        const { bench, grants, time } = open();
        const first = fresh(), extra = fresh();
        expect((await register(grants, time, [first, extra])).body).toMatchObject({ granted: 1, standby: 1 });
        const full = { ok: false, status: 409, reason: 'table-full', body: { tableFull: true, message: TABLE_FULL } };
        expect(await grants.redeemGrant({ value: extra, now: time.now() })).toEqual(full);
        expect(bench.table(scope).seats.b).toBe(null);
        expect((await grants.redeemGrant({ value: first, now: time.now() })).status).toBe(200);
        expect(bench.table(scope).status).toBe('playing');
        expect(await grants.redeemGrant({ value: extra, now: time.now() })).toEqual(full);
        expect(Object.values(bench.table(scope).seats)).toHaveLength(2);
    });

    it('revokes unclaimed grants without deleting the waiting table', async () => {
        const { bench, grants, time } = open();
        const value = fresh();
        await register(grants, time, [value, fresh()]);
        expect(await grants.revokeAll(table.room)).toEqual({ revoked: 2 });
        expect(bench.grantRows()).toEqual([]);
        expect(bench.table(scope)).toMatchObject({ present: true, status: 'waiting', seats: { w: table.host, b: null } });
        expect((await grants.redeemGrant({ value, now: time.now() })).status).toBe(410);
    });

    it('answers 410 when the table closed while a grant was out', async () => {
        const { bench, grants, time } = open();
        const value = fresh();
        await register(grants, time, [value]);
        bench.closeTable(table);
        expect((await grants.redeemGrant({ value, now: time.now() })).status).toBe(410);
        expect(bench.grantRows()).toEqual([]);
    });
});
