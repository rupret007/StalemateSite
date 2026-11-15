// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';

const room = '#game-2ca9e1x1be34a';
const ref = '0'.repeat(32);
const sid = 'seat-white';
const actor = 'c' + '1'.repeat(32);
const guest = 'c' + '2'.repeat(32);

function fixture() {
    const records = new Map(), actors = new Map(), connections = [];
    let now = 1000, matchCount = 0, alarm = null;
    const storage = {
        getAlarm: async () => alarm,
        setAlarm: async at => { alarm = at; },
        get: vi.fn(async key => structuredClone(records.get(key))),
        put: vi.fn(async (key, value) => {
            for (const [name, record] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) {
                records.set(name, structuredClone(record));
            }
        }),
        delete: vi.fn(async key => { records.delete(key); }),
        list: vi.fn(async ({ prefix = '' } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix))))
    };
    function player(id, betaSid, canOpen) {
        const binding = { betaSid, betaInviteVersion: 1, canPlay: true, canOpen,
            canJoin: subject => subject !== betaSid, canSee: () => true };
        actors.set(id, binding);
        let attachment = { actor: id, betaSid, betaInviteVersion: 1, room, ref, kind: ARCADE_TAG };
        const socket = { frames: [], readyState: 1, serializeAttachment: data => { attachment = data; },
            deserializeAttachment: () => attachment, send(value) { this.frames.push(JSON.parse(value)); },
            close: vi.fn() };
        connections.push(socket);
        return socket;
    }
    const a = player(actor, sid, true), b = player(guest, 'seat-black', false);
    const guestActivity = vi.fn(async () => {});
    const transport = createArcadeTransport({ state: { storage, getWebSockets: () => connections }, name: 'chess', guestActivity,
        now: () => now, uuid: () => 'c8eb7f10-e113-418f-9900-' + String(++matchCount).padStart(12, '0'),
        current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
        charge: async () => true, allowed: () => true });
    const send = (socket, action, fields = {}) => transport.receive(socket, JSON.stringify({ version: 1, action, ...fields }));
    const board = socket => socket.frames.findLast(frame => frame.t === 'match-state' || frame.t === 'snapshot')?.state;
    const start = async () => {
        await send(a, 'open');
        const { id, tableId } = board(b);
        await send(b, 'join', { id });
        return { id, tableId, revision: 0, move: 'e2e4' };
    };
    const connect = (id, betaSid, canOpen = false) => player(id, betaSid, canOpen);
    const saved = () => storage.put.mock.calls.at(-1)?.[1]?.chess;
    return { a, b, board, send, start, storage, actors, transport, connect, saved };
}

function watchInvite(hostSid, match, tableId) {
    return { room, ref, host: hostSid, match, tableId, game: 'chess', watch: true };
}

describe('Chess watch invite at the transport', () => {
    it('joins a running match read-only, refuses moves, holds no seat and is not lined up', async () => {
        const f = fixture();
        const watchActor = 'c' + '3'.repeat(32);
        const move = await f.start();
        const watcher = f.connect(watchActor, 'seat-watch');
        f.actors.get(watchActor).gameGuest = watchInvite(sid, move.id, move.tableId);
        await f.send(watcher, undefined, { t: 'hello', lastSeq: 0 });
        expect(watcher.frames.at(-1)).toMatchObject({ t: 'snapshot', yourSeat: null, canOpen: false });
        expect(f.board(watcher)).toMatchObject({
            watchOnly: true, seat: null, waiting: false, id: move.id, tableId: move.tableId
        });
        expect(f.board(watcher).upNext).toBeUndefined();
        expect(f.board(watcher).match).toMatchObject({ revision: 0, turn: 'w' });
        expect(f.saved().nextGame ?? []).not.toContain('seat-watch');

        const before = watcher.frames.length;
        await f.send(watcher, 'move', move);
        expect(watcher.frames.at(-1)).toEqual({ t: 'match-error', reason: 'unavailable' });
        expect(watcher.frames.slice(before, -1).every(frame => frame.t !== 'match-state')).toBe(true);
        expect(f.board(f.a).match.moves).toEqual([]);

        await f.send(watcher, 'join', { id: move.id, seat: 'next' });
        expect(watcher.frames.at(-1)).toEqual({ t: 'match-error', reason: 'unavailable' });
        expect(f.board(watcher).upNext).toBeUndefined();
        expect(f.saved().nextGame ?? []).not.toContain('seat-watch');
    });

    it('keeps both seated players in the same seats after start-rematch while the watcher stays unseated', async () => {
        const f = fixture();
        const watchActor = 'c' + '5'.repeat(32);
        const move = await f.start();
        const watcher = f.connect(watchActor, 'seat-watch');
        f.actors.get(watchActor).gameGuest = watchInvite(sid, move.id, move.tableId);
        await f.send(watcher, undefined, { t: 'hello', lastSeq: 0 });
        const seats = [f.board(f.a).seat, f.board(f.b).seat];
        expect(seats).toEqual(['w', 'b']);
        expect(f.board(watcher)).toMatchObject({ watchOnly: true, seat: null });

        await f.send(f.b, 'resign', { id: move.id, revision: 0 });
        await f.send(f.a, 'start-rematch', { id: move.id });
        const next = f.board(f.a).id;
        expect(next).not.toBe(move.id);
        expect([f.board(f.a).seat, f.board(f.b).seat]).toEqual(seats);
        await f.send(watcher, 'sync');
        expect(f.board(watcher)).toMatchObject({ id: next, watchOnly: true, seat: null, tableId: move.tableId });
        expect(f.board(watcher).upNext).toBeUndefined();
        expect(f.board(watcher).match?.revision).toBe(0);
    });

    it('keeps a stored watch-only seat through the live hand then frees it on start-rematch for who was up next', async () => {
        const f = fixture();
        const guestActor = guest;
        const waitingActor = 'c' + '6'.repeat(32);
        const waiting = f.connect(waitingActor, 'seat-next');
        const move = await f.start();
        await f.send(waiting, undefined, { t: 'hello', lastSeq: 0 });
        expect(f.board(waiting)).toMatchObject({ seat: null, upNext: true });
        // The table still lists the guest in Black, but the invitation is watch-only.
        f.actors.get(guestActor).gameGuest = watchInvite(sid, move.id, move.tableId);
        const held = { w: sid, b: 'seat-black' };
        expect(f.saved().seats).toMatchObject(held);
        await f.send(f.b, 'sync');
        expect(f.board(f.b)).toMatchObject({ watchOnly: true, seat: null });
        expect(f.saved().seats).toMatchObject(held);
        const turn = f.board(f.a).match.turn;
        await f.send(f.b, 'move', { id: move.id, revision: 0, move: 'e7e5' });
        expect(f.b.frames.at(-1)).toEqual({ t: 'match-error', reason: 'unavailable' });
        expect(f.board(f.a).match.turn).toBe(turn);
        expect(f.board(waiting)).toMatchObject({ seat: null, upNext: true });

        await f.send(f.a, 'resign', { id: move.id, revision: 0 });
        await f.send(f.a, 'start-rematch', { id: move.id });
        const next = f.board(f.a).id;
        expect(next).not.toBe(move.id);
        expect(f.saved().seats).toMatchObject({ w: sid, b: 'seat-next' });
        expect(f.saved().nextGame).toBeUndefined();
        expect(f.board(f.a).seat).toBe('w');
        expect(f.board(waiting).seat).toBe('b');
        expect(f.board(waiting).upNext).toBeUndefined();
        expect(f.board(f.b)).toMatchObject({ id: next, watchOnly: true, seat: null });
        expect(f.board(f.b).upNext).toBeUndefined();
    });
});