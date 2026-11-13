// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TABLE_FULL_COPY as WORKER_COPY } from '../../hangout-worker/src/game-night-room-grants.mjs';
import {
    ASK_HOST_COPY, REDEEM_METHOD, REDEEM_PATH, TABLE_FULL_COPY, mapTakenSeats, redeemRequest
} from '../../r/45662413410ed051/lobby/bridge-table-full.mjs';

const VALUE = 'a'.repeat(32);
const ATTEMPT = 'b'.repeat(32);

describe('bridge table-full mapper', () => {
    it('uses the grants module sentence and stays in the room when both seats are taken', () => {
        expect(TABLE_FULL_COPY).toBe(WORKER_COPY);
        expect(TABLE_FULL_COPY).toBe("Table full, you're up next game");
        const mapped = mapTakenSeats({ seatsTaken: true });
        expect(mapped).toEqual({ handled: true, stayInRoom: true, message: TABLE_FULL_COPY, askHost: false, next: null });
        expect(mapped.message).not.toBe(ASK_HOST_COPY);
        expect(mapTakenSeats({
            status: 409,
            body: { tableFull: true, message: TABLE_FULL_COPY }
        }).message).toBe(TABLE_FULL_COPY);
    });

    it('leaves a missing route and an expired invite on the caller', () => {
        expect(mapTakenSeats({ status: 404, body: { error: 'Game invitations are unavailable.' } })).toMatchObject({ handled: false, stayInRoom: false });
        expect(mapTakenSeats({ status: 410, body: { error: 'expired' } })).toMatchObject({ handled: false, message: null });
        expect(mapTakenSeats({ status: 409, body: { tableFull: false } })).toMatchObject({ handled: false });
        expect(mapTakenSeats().message).toBeNull();
    });

    it('builds the redeem call the hook documents, and no other call', () => {
        expect(redeemRequest({ value: 'short', attempt: ATTEMPT })).toBeNull();
        const request = redeemRequest({ value: VALUE, attempt: ATTEMPT });
        expect(request).toEqual({
            method: REDEEM_METHOD,
            path: REDEEM_PATH,
            headers: { 'Content-Type': 'application/json' },
            body: { value: VALUE, attempt: ATTEMPT, age13: true }
        });
        expect(request.method).toBe('POST');
        expect(request.path).toBe('/beta/game-night/room-grant/redeem');
        const doc = readFileSync(new URL('../../hangout-internal/BRIDGE-HOOKS.md', import.meta.url), 'utf8');
        const contract = doc.slice(doc.indexOf('## Redeem call contract'));
        expect(contract).toContain('POST /beta/game-night/room-grant/redeem');
        expect(contract).toContain('"age13": true');
        expect(contract).toContain('"tableFull": true');
        expect(contract).toContain(TABLE_FULL_COPY);
        expect(contract).toContain('stays in that room');
        expect(contract).not.toContain(VALUE);
    });
});
