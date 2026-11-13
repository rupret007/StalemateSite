// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    EXPIRED_ERROR, GRANT_TTL_MS, HOLD_MS, TABLE_FULL, USING_STAND_IN, createRoomGrants, hashGrant
} from '../e2e/support/bridge-grants-adapter.mjs';

const host = { hostSession: 'host-session', room: 'room-chess', match: 'match-chess', game: 'chess' };

function clock(start = 1_700_000_000_000) {
    let at = start;
    return { now: () => at, set: value => { at = value; } };
}

async function openTable(time = clock()) {
    const grants = createRoomGrants({ now: time.now });
    const seated = await grants.seatHost(host);
    expect(seated.status).toBe(200);
    expect(await seated.json()).toMatchObject({ status: 'waiting', seat: 'w' });
    return { grants, time };
}

async function confirm(grants, hashes, time) {
    return grants.registerGrants({
        ...host, confirmed: true, now: time.now(),
        grants: hashes.map(hash => ({ hash, seat: 'next' }))
    });
}

describe('bridge grant stand-in', () => {
    it('is the labeled stand-in and documents the one-line module swap', () => {
        expect(USING_STAND_IN).toBe(true);
        const source = readFileSync(new URL('../e2e/support/bridge-grants-adapter.mjs', import.meta.url), 'utf8');
        expect(source).toContain('STAND-IN');
        expect(source).toContain("export { createRoomGrants } from '../../../hangout-worker/src/game-night-room-grants.mjs'");
    });

    it('seats the host from their own session before any grant exists', async () => {
        const { grants } = await openTable();
        const [table] = grants.snapshot();
        expect(table).toMatchObject({ status: 'waiting', present: true, seats: { w: 'host-session', b: null }, holds: [], grants: [] });
    });

    it('does not issue a grant when the host page loads', async () => {
        const { grants, time } = await openTable();
        const raw = randomBytes(16).toString('hex');
        const before = JSON.stringify(grants.snapshot());
        expect(grants.notePageLoad({ fragment: `#h=${await hashGrant(raw)}` })).toEqual({ registered: 0, issued: false });
        expect(JSON.stringify(grants.snapshot())).toBe(before);
        const refused = await grants.registerGrants({ ...host, confirmed: false, grants: [{ hash: await hashGrant(raw), seat: 'next' }], now: time.now() });
        expect(refused.status).toBe(400);
        expect(JSON.stringify(grants.snapshot())).toBe(before);
        expect(JSON.stringify(grants.snapshot()).includes(raw)).toBe(false);
    });

    it('stores hashes only and rejects a specific seat or a raw grant', async () => {
        const { grants, time } = await openTable();
        const raw = randomBytes(16).toString('hex');
        const hash = await hashGrant(raw);
        const rawRejected = await grants.registerGrants({ ...host, confirmed: true, now: time.now(), grants: [{ hash, seat: 'next', raw }] });
        expect(rawRejected.status).toBe(400);
        const seatRejected = await grants.registerGrants({ ...host, confirmed: true, now: time.now(), grants: [{ hash, seat: 'b' }] });
        expect(seatRejected.status).toBe(400);
        expect(grants.snapshot()[0].grants).toEqual([]);
        const issued = await confirm(grants, [hash], time);
        expect(issued.status).toBe(200);
        const stored = JSON.stringify(grants.snapshot());
        expect(stored.includes(raw)).toBe(false);
        expect(stored.includes(hash)).toBe(true);
        expect(grants.snapshot()[0].holds).toHaveLength(1);
        expect(grants.snapshot()[0].holds[0]).toMatchObject({ seat: 'b', until: time.now() + HOLD_MS });
    });

    it('returns the existing 410 expired shape when a burned grant is replayed', async () => {
        const { grants, time } = await openTable();
        const raw = randomBytes(16).toString('hex');
        expect((await confirm(grants, [await hashGrant(raw)], time)).status).toBe(200);
        const first = await grants.redeemGrant({ session: 'phone-guest', raw, ...host, now: time.now() });
        expect(first.status).toBe(200);
        expect(await first.json()).toMatchObject({ seat: 'b', waiting: false });
        const replay = await grants.redeemGrant({ session: 'phone-guest', raw, ...host, now: time.now() });
        expect(replay.status).toBe(410);
        expect(await replay.json()).toEqual({ error: EXPIRED_ERROR });
        expect(JSON.stringify(grants.snapshot()).includes(raw)).toBe(false);
    });

    it('refuses a host session without burning the guest grant', async () => {
        const { grants, time } = await openTable();
        const raw = randomBytes(16).toString('hex');
        expect((await confirm(grants, [await hashGrant(raw)], time)).status).toBe(200);
        const hostTry = await grants.redeemGrant({ session: host.hostSession, raw, ...host, now: time.now() });
        expect(hostTry.status).toBe(403);
        expect(grants.snapshot()[0].grants[0].burned).toBe(false);
        expect(grants.snapshot()[0].seats).toEqual({ w: 'host-session', b: null });
        const guest = await grants.redeemGrant({ session: 'phone-guest', raw, ...host, now: time.now() });
        expect(guest.status).toBe(200);
    });

    it('releases an expired hold and leaves the host table waiting', async () => {
        const time = clock();
        const { grants } = await openTable(time);
        const raw = randomBytes(16).toString('hex');
        expect((await confirm(grants, [await hashGrant(raw)], time)).status).toBe(200);
        time.set(time.now() + HOLD_MS);
        const swept = grants.sweep();
        expect(swept.released).toEqual([{ room: host.room, match: host.match, seat: 'b' }]);
        expect(swept.tables).toHaveLength(1);
        expect(swept.tables[0]).toMatchObject({
            present: true, status: 'waiting', seats: { w: 'host-session', b: null }, holds: []
        });
        const late = await grants.redeemGrant({ session: 'phone-guest', raw, ...host, now: time.now() });
        expect(late.status).toBe(410);
        expect(await late.json()).toEqual({ error: EXPIRED_ERROR });
        expect(grants.snapshot()).toHaveLength(1);
        expect(grants.snapshot()[0].status).toBe('waiting');
        expect(grants.snapshot()[0].seats.w).toBe('host-session');
        expect(GRANT_TTL_MS).toBeGreaterThan(HOLD_MS);
    });

    it('tells the extra person the table is full and keeps the next-game control enabled', async () => {
        const { grants, time } = await openTable();
        const first = randomBytes(16).toString('hex');
        const extra = randomBytes(16).toString('hex');
        const issued = await confirm(grants, [await hashGrant(first), await hashGrant(extra)], time);
        const body = await issued.json();
        expect(body.grants).toHaveLength(1);
        expect(body.overflow).toEqual([{ message: TABLE_FULL, enabled: true, disabled: false }]);
        const third = await grants.redeemGrant({ session: 'extra-person', raw: extra, ...host, now: time.now() });
        expect(third.status).toBe(200);
        expect(await third.json()).toEqual({ message: TABLE_FULL, enabled: true, disabled: false });
        expect(grants.snapshot()[0].grants).toHaveLength(1);
        const seated = await grants.redeemGrant({ session: 'phone-guest', raw: first, ...host, now: time.now() });
        expect(seated.status).toBe(200);
        const after = await grants.redeemGrant({ session: 'someone-else', raw: extra, ...host, now: time.now() });
        expect(await after.json()).toEqual({ message: TABLE_FULL, enabled: true, disabled: false });
    });

    it('revokes unclaimed grants without deleting the waiting table', async () => {
        const { grants, time } = await openTable();
        expect((await confirm(grants, [await hashGrant(randomBytes(16).toString('hex'))], time)).status).toBe(200);
        const revoked = grants.revokeAll({ room: host.room, match: host.match });
        expect(revoked.revoked).toBe(1);
        expect(revoked.tables[0]).toMatchObject({ present: true, status: 'waiting', seats: { w: 'host-session', b: null }, holds: [] });
    });
});
