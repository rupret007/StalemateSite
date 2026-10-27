// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createLobby, LOBBY_LIMITS } from '../../hangout-worker/src/lobby-core.mjs';
import { createTransportControlBudget } from '../../hangout-worker/src/transport-budget.mjs';
import { createControlCreditObservation } from '../runtime/lobby-session-authority/control-credit-observation.mjs';

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

// Observe the actual engine/budget calls; never grant, retry or override a
// production result. The clock remains the existing unit fixture's input.
describe('UTC-day transport-credit observation', () => {
    const copy = value => value === undefined ? undefined : structuredClone(value);
    function observed(f, observation = createControlCreditObservation()) {
        const receiptsByDay = new Map();
        const reserve = vi.fn(async id => {
            const result = await f.options.reserve(id);
            if (result?.ok === true) receiptsByDay.set(result.day, (receiptsByDay.get(result.day) || 0) + 1);
            observation.reservation(id, result); return result;
        });
        const budget = createTransportControlBudget({ ...f.options, reserve });
        return { observation, budget, reserve, receiptsByDay,
            async take(socket = f.socket, id = 'one') {
                const before = copy(f.attachments.get(socket)), accepted = await budget.take(socket, id);
                observation.consumption(id, before, copy(f.attachments.get(socket)), accepted); return accepted;
            },
            snapshot(socket = f.socket, id = 'one') { return observation.snapshot(id, copy(f.attachments.get(socket))); } };
    }
    function conserved(snapshot) {
        expect(snapshot.invalid).toBe(false); expect(snapshot.overflow).toBe(false);
        for (const row of snapshot.days) {
            expect(Object.keys(row).sort()).toEqual(['day', 'reservations', 'controls', 'openingControls',
                'discardedControls', 'remainingControls', 'unassignedControls'].sort());
            expect(row.reservations * 20 + row.openingControls).toBe(row.controls + row.discardedControls + row.remainingControls + row.unassignedControls);
        }
    }

    it('reconciles actual same-day controls at 20, 21 and 40 without extra reservations', async () => {
        const f = fixture(), o = observed(f), before = f.engine.snapshot().budget.requests;
        for (let n = 1; n <= 40; n++) {
            expect(await o.take()).toBe(true);
            if (![20, 21, 40].includes(n)) continue;
            const snapshot = o.snapshot(); conserved(snapshot);
            expect(snapshot.days).toEqual([{ day: '2026-10-25', reservations: n === 20 ? 1 : 2, controls: n,
                openingControls: 0, discardedControls: 0, remainingControls: n === 21 ? 19 : 0, unassignedControls: 0 }]);
        }
        expect(o.reserve).toHaveBeenCalledTimes(2);
        expect(o.budget.snapshot()).toEqual({ reservations: 2, prepaidControls: 40, consumedControls: 40, refused: 0 });
        expect(f.engine.snapshot().budget.requests).toBeCloseTo(before + 2);
    });

    it('counts 174 real blocks across 50 slots and two UTC days where lifetime ceilings incorrectly give 150', async () => {
        const f = fixture(), o = observed(f), slots = [{ id: 'one', socket: f.socket }];
        for (let index = 1; index < 50; index++) {
            const id = 'credit-slot-' + String(index).padStart(2, '0');
            expect(f.engine.connect({ id, dev: 'dev-' + id, iph: 'ip-' + id }).ok).toBe(true);
            await f.engine.message(id, JSON.stringify({ t: 'hello', nick: 'CreditGuest' + String(index).padStart(2, '0'), age13: true }));
            expect(f.engine._debug.conns.get(id).nick).toBe('CreditGuest' + String(index).padStart(2, '0'));
            slots.push({ id, socket: {} });
        }
        expect(f.engine._debug.conns.size).toBe(50);
        const before = f.engine.snapshot().budget.requests;
        for (let index = 0; index < slots.length; index++) {
            const slot = slots[index], count = index < 24 ? 25 : 50;
            for (let n = 0; n < count; n++) expect(await o.take(slot.socket, slot.id)).toBe(true);
        }
        expect(o.budget.snapshot()).toEqual({ reservations: 126, prepaidControls: 2520, consumedControls: 1900, refused: 0 });
        expect(f.engine.snapshot().budget.requests).toBeCloseTo(before + 126);
        f.clock(Date.parse('2026-10-26T00:00:01Z'));
        for (const slot of slots.slice(0, 24)) for (let n = 0; n < 25; n++) expect(await o.take(slot.socket, slot.id)).toBe(true);
        expect(o.reserve).toHaveBeenCalledTimes(174);
        expect(o.budget.snapshot()).toEqual({ reservations: 174, prepaidControls: 3480, consumedControls: 2500, refused: 0 });
        expect([...o.receiptsByDay]).toEqual([['2026-10-25', 126], ['2026-10-26', 48]]);
        expect(f.store.get('net').budget).toEqual({ day: '2026-10-26', requests: 48 });
        const totals = new Map();
        for (let index = 0; index < slots.length; index++) {
            const slot = slots[index], snapshot = o.snapshot(slot.socket, slot.id); conserved(snapshot);
            expect(snapshot.days).toEqual(index < 24 ? [
                { day: '2026-10-25', reservations: 2, controls: 25, openingControls: 0, discardedControls: 15, remainingControls: 0, unassignedControls: 0 },
                { day: '2026-10-26', reservations: 2, controls: 25, openingControls: 0, discardedControls: 0, remainingControls: 15, unassignedControls: 0 }
            ] : [{ day: '2026-10-25', reservations: 3, controls: 50, openingControls: 0, discardedControls: 0, remainingControls: 10, unassignedControls: 0 }]);
            for (const row of snapshot.days) {
                if (!totals.has(row.day)) totals.set(row.day, { reservations: 0, controls: 0, openingControls: 0, discardedControls: 0, remainingControls: 0, unassignedControls: 0 });
                for (const key of Object.keys(totals.get(row.day))) totals.get(row.day)[key] += row[key];
            }
        }
        expect([...totals]).toEqual([
            ['2026-10-25', { reservations: 126, controls: 1900, openingControls: 0, discardedControls: 360, remainingControls: 260, unassignedControls: 0 }],
            ['2026-10-26', { reservations: 48, controls: 600, openingControls: 0, discardedControls: 0, remainingControls: 360, unassignedControls: 0 }]
        ]);
        // Every slot consumed 50 lifetime controls, but midnight discards 24
        // partially used day-one grants before a fresh real reservation.
        const lifetimeCeiling = slots.reduce(total => total + Math.ceil(50 / 20), 0);
        expect(lifetimeCeiling).toBe(150); expect(o.budget.snapshot().reservations - lifetimeCeiling).toBe(24);
    });

    it('accounts for real imported unused paid credit without inventing historical reservations', async () => {
        const f = fixture(), original = createTransportControlBudget(f.options);
        expect(await original.take(f.socket, 'one')).toBe(true);
        const paid = f.engine.snapshot().budget.requests, o = observed(f);
        expect(o.snapshot().days).toEqual([{ day: '2026-10-25', reservations: 0, controls: 0, openingControls: 19, discardedControls: 0, remainingControls: 19, unassignedControls: 0 }]);
        expect(await o.take()).toBe(true); expect(o.reserve).not.toHaveBeenCalled(); expect(f.engine.snapshot().budget.requests).toBe(paid);
        f.clock(Date.parse('2026-10-26T00:00:01Z')); expect(await o.take()).toBe(true);
        const snapshot = o.snapshot(); conserved(snapshot);
        expect(snapshot.days).toEqual([
            { day: '2026-10-25', reservations: 0, controls: 1, openingControls: 19, discardedControls: 18, remainingControls: 0, unassignedControls: 0 },
            { day: '2026-10-26', reservations: 1, controls: 1, openingControls: 0, discardedControls: 0, remainingControls: 19, unassignedControls: 0 }
        ]);
        expect(o.budget.snapshot()).toEqual({ reservations: 1, prepaidControls: 20, consumedControls: 2, refused: 0 });
    });

    it('retains the actual midnight-during-commit refusal and reports its unassigned block without retry', async () => {
        const f = fixture(); let finish;
        f.writer(value => new Promise(resolve => { finish = () => { f.store.set('net', structuredClone(value)); resolve(); }; }));
        const o = observed(f), taking = o.take();
        await Promise.resolve(); f.clock(Date.parse('2026-10-26T00:00:01Z')); finish();
        expect(await taking).toBe(false); expect(f.attachments.has(f.socket)).toBe(false);
        expect(o.reserve).toHaveBeenCalledExactlyOnceWith('one');
        expect(o.budget.snapshot()).toEqual({ reservations: 1, prepaidControls: 20, consumedControls: 0, refused: 1 });
        const snapshot = o.snapshot(); conserved(snapshot);
        expect(snapshot.days).toEqual([{ day: '2026-10-25', reservations: 1, controls: 0, openingControls: 0, discardedControls: 0, remainingControls: 0, unassignedControls: 20 }]);
        expect(f.store.get('net').budget.day).toBe('2026-10-25');
    });

    it('keeps a corrupt-observation flag sticky without changing subsequent real control outcomes', async () => {
        const f = fixture(), o = observed(f); expect(await o.take()).toBe(true);
        const actual = copy(f.attachments.get(f.socket));
        expect(o.observation.snapshot('one', { ...actual, remaining: actual.remaining - 1 }).invalid).toBe(true);
        expect(f.attachments.get(f.socket)).toEqual(actual);
        expect(await o.take()).toBe(true); const snapshot = o.snapshot();
        expect(snapshot.invalid).toBe(true); expect(snapshot.overflow).toBe(false);
        expect(f.attachments.get(f.socket).remaining).toBe(18);
        expect(o.budget.snapshot()).toEqual({ reservations: 1, prepaidControls: 20, consumedControls: 2, refused: 0 });
    });

    it('does not change a real second connection when the bounded observer has no connection slot', async () => {
        const f = fixture(), o = observed(f, createControlCreditObservation({ maxConnections: 1 }));
        expect(await o.take()).toBe(true);
        expect(f.engine.connect({ id: 'two', dev: 'dev-two', iph: 'ip-two' }).ok).toBe(true);
        await f.engine.message('two', JSON.stringify({ t: 'hello', nick: 'SecondCreditGuest', age13: true }));
        const socket = {}; expect(await o.take(socket, 'two')).toBe(true);
        expect(o.snapshot().overflow).toBe(true); expect(f.attachments.get(socket)).toEqual({ v: 1, day: '2026-10-25', remaining: 19 });
        expect(o.reserve).toHaveBeenCalledTimes(2);
        expect(o.budget.snapshot()).toEqual({ reservations: 2, prepaidControls: 40, consumedControls: 2, refused: 0 });
    });

    it('keeps a real day-two grant intact when the observer day bound is exhausted', async () => {
        const f = fixture(), o = observed(f, createControlCreditObservation({ maxDays: 1 }));
        expect(await o.take()).toBe(true); f.clock(Date.parse('2026-10-26T00:00:01Z')); expect(await o.take()).toBe(true);
        const snapshot = o.snapshot(); expect(snapshot.overflow).toBe(true);
        expect(f.attachments.get(f.socket)).toEqual({ v: 1, day: '2026-10-26', remaining: 19 });
        expect(o.reserve).toHaveBeenCalledTimes(2);
        expect(o.budget.snapshot()).toEqual({ reservations: 2, prepaidControls: 40, consumedControls: 2, refused: 0 });
    });
});
