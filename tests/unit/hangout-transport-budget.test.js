// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createLobby, LOBBY_LIMITS } from '../../hangout-worker/src/lobby-core.mjs';
import { createTransportControlBudget } from '../../hangout-worker/src/transport-budget.mjs';

function fixture() {
    let time = Date.parse('2026-10-25T23:59:00Z');
    const store = new Map(), attachments = new WeakMap();
    let write = (value) => { store.set('net', structuredClone(value)); };
    const persist = vi.fn((kind, value) => kind === 'net' ? write(value) : undefined);
    const engine = createLobby({ now: () => time, persist });
    engine.connect({ id: 'one', dev: 'dev-one', iph: 'ip-one' });
    engine.message('one', JSON.stringify({ t: 'hello', nick: 'ControlGuest', age13: true }));
    const options = { now: () => time, reserve: id => engine.reserveTransportControl(id), available: id => engine.transportControlReady(id),
        readState: ws => attachments.get(ws), writeState: (ws, value) => attachments.set(ws, structuredClone(value)) };
    return { engine, store, attachments, persist, options, socket: {},
        clock: value => { time = value; }, writer: fn => { write = fn; }, day: () => new Date(time).toISOString().slice(0, 10) };
}

describe('transport control shares the durable request budget', () => {
    it('prepays 20 controls per required network write and does not mint grants through chat commands', async () => {
        const f = fixture(), budget = createTransportControlBudget(f.options);
        const before = f.engine.snapshot().budget.requests;
        for (let i = 0; i < 20; i += 1) expect(await budget.take(f.socket, 'one')).toBe(true);
        expect(f.persist.mock.calls.filter(([kind]) => kind === 'net')).toHaveLength(1);
        expect(f.store.get('net').budget.requests).toBeCloseTo(before + 1);
        expect(f.attachments.get(f.socket)).toEqual({ v: 1, day: f.day(), remaining: 0 });
        expect(await budget.take(f.socket, 'one')).toBe(true);
        expect(f.persist.mock.calls.filter(([kind]) => kind === 'net')).toHaveLength(2);
        expect(f.store.get('net').budget.requests).toBeCloseTo(before + 2);
        const used = f.engine.snapshot().budget.requests;
        expect(await f.engine.reserveTransportControl('invented-connection')).toEqual({ ok: false });
        expect(f.engine.snapshot().budget.requests).toBe(used);
        const controls = f.attachments.get(f.socket);
        await f.engine.message('one', JSON.stringify({ t: 'cmd', name: 'reserveTransportControl', args: ['40000'], ch: '#stalemate' }));
        expect(f.attachments.get(f.socket)).toEqual(controls);
        expect(f.engine.snapshot().budget.requests).toBeCloseTo(used + 1 / 20);
    });

    it('exhausts the existing shared budget without a separate allowance or staff bypass', async () => {
        const f = fixture(), budget = createTransportControlBudget(f.options);
        f.engine.restore({ ...f.engine.snapshot(), budget: { day: f.day(), requests: LOBBY_LIMITS.requestBudget * .95 - 1 } });
        expect(await budget.take(f.socket, 'one')).toBe(true);
        for (let i = 1; i < 20; i += 1) expect(await budget.take(f.socket, 'one')).toBe(true);
        expect(await budget.take(f.socket, 'one')).toBe(false);
        expect(f.engine.snapshot().budget.requests).toBe(LOBBY_LIMITS.requestBudget * .95);
        f.engine._debug.conns.get('one').role = 'owner';
        expect(await budget.take(f.socket, 'one')).toBe(false);
        expect(f.persist.mock.calls.filter(([kind]) => kind === 'net')).toHaveLength(1);
    });

    it('withholds credit until storage commits and keeps failed storage closed across midnight', async () => {
        const f = fixture(); let reject;
        f.writer(() => new Promise((_resolve, rejectWrite) => { reject = rejectWrite; }));
        const budget = createTransportControlBudget(f.options), taking = budget.take(f.socket, 'one');
        await Promise.resolve();
        expect(f.attachments.has(f.socket)).toBe(false); expect(f.store.has('net')).toBe(false);
        reject(Error('synthetic storage failure')); expect(await taking).toBe(false);
        expect(f.engine.snapshot()).toMatchObject({ lock: 'readonly', lockAuto: true });
        const failed = structuredClone(f.engine.snapshot().budget), attempts = f.persist.mock.calls.length;
        f.clock(Date.parse('2026-10-26T00:01:00Z'));
        expect(await budget.take(f.socket, 'one')).toBe(false);
        expect(f.engine.snapshot().budget).toEqual(failed); expect(f.persist).toHaveBeenCalledTimes(attempts);
    });

    it('does not consume previously paid credit after storage becomes untrusted', async () => {
        const f = fixture(), budget = createTransportControlBudget(f.options);
        expect(await budget.take(f.socket, 'one')).toBe(true);
        const grant = structuredClone(f.attachments.get(f.socket));
        f.writer(() => Promise.reject(Error('synthetic storage failure')));
        await f.engine.reserveTransportControl('one');
        expect(await budget.take(f.socket, 'one')).toBe(false);
        expect(f.attachments.get(f.socket)).toEqual(grant);
        expect(f.engine.snapshot()).toMatchObject({ lock: 'readonly', lockAuto: true });
    });

    it('restores only unused paid credit after hibernation and discards yesterday credit at rollover', async () => {
        const f = fixture(), first = createTransportControlBudget(f.options);
        expect(await first.take(f.socket, 'one')).toBe(true);
        const paid = f.engine.snapshot().budget.requests;
        const resumed = createTransportControlBudget(f.options);
        expect(await resumed.take(f.socket, 'one')).toBe(true);
        expect(f.attachments.get(f.socket).remaining).toBe(18); expect(resumed.snapshot().reservations).toBe(0);
        expect(f.engine.snapshot().budget.requests).toBe(paid);
        f.clock(Date.parse('2026-10-26T00:00:01Z'));
        expect(await resumed.take(f.socket, 'one')).toBe(true);
        expect(f.attachments.get(f.socket)).toEqual({ v: 1, day: '2026-10-26', remaining: 19 });
        expect(f.store.get('net').budget).toEqual({ day: '2026-10-26', requests: 1 });
    });

    it('rejects future/corrupt grant records instead of resetting them into new paid credit', async () => {
        for (const grant of [null, { v: 1, day: '2026-10-26', remaining: 19 }, { v: 1, day: '2026-10-25', remaining: 20 }, { v: 1, day: '2026-13-25', remaining: 10 }]) {
            const f = fixture(); f.attachments.set(f.socket, grant);
            const budget = createTransportControlBudget(f.options), before = structuredClone(f.engine.snapshot().budget);
            expect(await budget.take(f.socket, 'one')).toBe(false);
            expect(f.engine.snapshot().budget).toEqual(before); expect(f.store.has('net')).toBe(false);
        }
    });

    it('never borrows a previous day grant if midnight crosses its storage commit', async () => {
        const f = fixture(); let finish;
        f.writer(value => new Promise(resolve => { finish = () => { f.store.set('net', structuredClone(value)); resolve(); }; }));
        const budget = createTransportControlBudget(f.options), taking = budget.take(f.socket, 'one');
        await Promise.resolve(); f.clock(Date.parse('2026-10-26T00:00:01Z')); finish();
        expect(await taking).toBe(false); expect(f.attachments.has(f.socket)).toBe(false);
        expect(f.store.get('net').budget.day).toBe('2026-10-25');
        expect(budget.snapshot()).toMatchObject({ reservations: 1, prepaidControls: 20, consumedControls: 0 });
    });
});
