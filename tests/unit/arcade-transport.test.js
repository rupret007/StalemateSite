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
    let now = 1000;
    const storage = {
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
    const transport = createArcadeTransport({ state: { storage, getWebSockets: () => connections },
        now: () => now, uuid: () => 'c8eb7f10-e113-418f-9900-7e23f4072497',
        current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
        charge: async () => true, allowed: () => true });
    const send = (socket, action, fields = {}) => transport.receive(socket, JSON.stringify({ version: 1, action, ...fields }));
    const board = socket => socket.frames.findLast(frame => frame.t === 'match-state')?.state;
    const start = async () => {
        await send(a, 'open');
        const { id } = board(b);
        await send(b, 'join', { id });
        return { id, revision: 0, move: 'e2e4' };
    };
    return { a, b, board, send, start, storage, actors, transport, player, advance: ms => { now += ms; } };
}

describe('Game Night match transport', () => {
    it('withholds an uncommitted move and permits a retry against the durable revision', async () => {
        const f = fixture(), move = await f.start();
        const before = f.b.frames.length;
        f.storage.put.mockRejectedValueOnce(Error('fixture failure'));
        await f.send(f.a, 'move', move);
        expect(f.a.frames.at(-1)).toEqual({ t: 'match-error', reason: 'storage-unavailable' });
        expect(f.b.frames).toHaveLength(before);
        expect(f.board(f.b).match.moves).toEqual([]);
        await f.send(f.a, 'move', move);
        expect(f.board(f.b).match.moves).toEqual(['e2e4']);
    });

    it('removes the view after a block and fences queued commands after membership ends', async () => {
        const f = fixture(), move = await f.start();
        f.actors.get(actor).canSee = subject => subject === sid;
        f.transport.reconcile();
        expect(f.board(f.a)).toBeNull();
        await f.send(f.a, 'move', move);
        expect(f.a.frames.at(-1)).toEqual({ t: 'match-error', reason: 'unavailable' });
        f.actors.delete(actor);
        f.transport.reconcile();
        const writes = f.storage.put.mock.calls.length;
        await f.send(f.a, 'move', move);
        expect(f.storage.put.mock.calls).toHaveLength(writes);
        expect(f.a.close).toHaveBeenCalledWith(4403, 'room membership ended');
    });

    it('commits the accepted invitation with the reserved capacity and admits its guest', async () => {
        const f = fixture();
        await f.send(f.a, 'open');
        const { id } = f.board(f.b);
        const scope = { room, ref, host: sid, match: id };
        const acceptance = { sid: 'invited-guest' };
        f.storage.put.mockRejectedValueOnce(Error('fixture failure'));
        await expect(f.transport.reserveGuestSeat(scope, acceptance.sid, 61000, 'invite', acceptance)).rejects.toThrow('fixture failure');
        expect(await f.storage.get('invite')).toBeUndefined();
        expect(await f.transport.hasGuestSeat(scope, id, sid)).toBe(true);
        expect(await f.transport.reserveGuestSeat(scope, acceptance.sid, 61000, 'invite', acceptance)).toBe(true);
        expect(await f.storage.get('invite')).toEqual(acceptance);
        expect(await f.transport.hasGuestSeat(scope, id, sid)).toBe(false);
        await f.send(f.b, 'join', { id });
        expect(f.b.frames.at(-1)).toEqual({ t: 'match-error', reason: 'seat-unavailable' });
        f.actors.get(guest).betaSid = acceptance.sid;
        f.b.serializeAttachment({ ...f.b.deserializeAttachment(), betaSid: acceptance.sid });
        await f.send(f.b, 'join', { id });
        expect(f.board(f.b)).toMatchObject({ seat: 'b', waiting: false });
        expect((await f.storage.get(ARCADE_TAG + ':' + ref)).claims).toBeUndefined();
    });

    it('extends an accepted seat once when the invited guest reaches the exact match', async () => {
        const f = fixture();
        await f.send(f.a, 'open');
        const { id } = f.board(f.b);
        const scope = { room, ref, host: sid, match: id };
        const guestBinding = f.actors.get(guest);
        guestBinding.gameGuest = { ...scope, game: 'chess' };
        await f.transport.reserveGuestSeat(scope, guestBinding.betaSid, 61000, 'invite', {});
        const saved = () => f.storage.get(ARCADE_TAG + ':' + ref);
        f.advance(59000);
        await f.send(f.b, 'sync');
        expect((await saved()).claims).toEqual([{ sid: guestBinding.betaSid, until: 120000, connected: true }]);
        f.advance(59000);
        f.b.serializeAttachment({ ...f.b.deserializeAttachment(), synced: false });
        await f.send(f.b, 'sync');
        expect((await saved()).claims[0].until).toBe(120000);
        await f.send(f.b, 'join', { id });
        expect(f.board(f.b)).toMatchObject({ id, seat: 'b' });
        expect((await saved()).claims).toBeUndefined();
    });

    it('releases an unused seat after its deadline while keeping the host table', async () => {
        const f = fixture();
        await f.send(f.a, 'open');
        const { id } = f.board(f.b);
        const scope = { room, ref, host: sid, match: id };
        expect(await f.transport.reserveGuestSeat(scope, 'invited-guest', 61000, 'invite', {})).toBe(true);
        f.advance(60000);
        await f.transport.maintain();
        expect(f.board(f.a)).toMatchObject({ id, waiting: true, hasOpenSeat: true });
        await f.send(f.b, 'join', { id });
        expect(f.board(f.b)).toMatchObject({ id, seat: 'b' });
    });

    it('keeps a seat through a dropped socket and returns it only to the same session', async () => {
        const f = fixture(), { id } = await f.start();
        // The phone drops: its socket closes and its room connection is gone.
        f.b.readyState = 3;
        f.actors.delete(guest);
        f.advance(90_000);
        await f.transport.maintain();
        f.transport.reconcile();
        expect(f.board(f.a)).toMatchObject({ id, seat: 'w' });
        expect(f.board(f.a).match).toBeTruthy();
        // Another session in the room watches. It cannot take or use the seat.
        const stranger = f.player('c' + '3'.repeat(32), 'seat-stranger', false);
        await f.send(stranger, 'sync');
        expect(f.board(stranger)).toMatchObject({ id, seat: null });
        await f.send(stranger, 'join', { id });
        expect(stranger.frames.at(-1)).toEqual({ t: 'match-error', reason: 'seat-unavailable' });
        await f.send(f.a, 'move', { id, revision: 0, move: 'e2e4' });
        await f.send(stranger, 'move', { id, revision: 1, move: 'e7e5' });
        expect(f.board(f.a).match.moves).toEqual(['e2e4']);
        // The same session reloads on a new connection and sits back down.
        const returned = f.player('c' + '4'.repeat(32), 'seat-black', false);
        await f.send(returned, 'sync');
        expect(f.board(returned)).toMatchObject({ id, seat: 'b' });
        await f.send(returned, 'move', { id, revision: 1, move: 'e7e5' });
        expect(f.board(f.a).match.moves).toEqual(['e2e4', 'e7e5']);
    });

    it('ends a two-player match at once when a seated player leaves the room or is removed', async () => {
        const f = fixture(), { id } = await f.start();
        expect(f.board(f.b)).toMatchObject({ id, seat: 'b' });
        expect(await f.transport.revoke({ room, ref }, 'seat-black')).toBe(true);
        expect(await f.storage.get(ARCADE_TAG + ':' + ref)).toBeUndefined();
        expect(f.board(f.a)).toBeNull();
        // The table is free again straight away, so the host is never stuck.
        await f.send(f.a, 'open');
        expect(f.board(f.a)).toMatchObject({ waiting: true, seat: 'w' });
    });

    it('does not leave a dropped player’s match open forever', async () => {
        const f = fixture(), { id } = await f.start();
        f.b.readyState = 3;
        f.actors.delete(guest);
        // The player still in the room can end it.
        await f.send(f.a, 'leave', { id });
        expect(await f.storage.get(ARCADE_TAG + ':' + ref)).toBeUndefined();
        // And an abandoned table is removed when the match lifetime runs out.
        await f.send(f.a, 'open');
        f.advance(40 * 60000);
        await f.transport.maintain();
        expect(await f.storage.get(ARCADE_TAG + ':' + ref)).toBeUndefined();
        expect(f.board(f.a)).toBeNull();
    });

    it('expires a room grant before opening a socket', async () => {
        const f = fixture(), session = { betaSid: sid, betaInviteVersion: 1 };
        const response = await f.transport.issue({ actor, room, ref }, session);
        const { ticket, protocol, expiresInMs } = await response.json();
        expect(response.status).toBe(200);
        f.advance(expiresInMs);
        expect((await f.transport.upgrade(`${protocol}, ${ticket}`, session)).status).toBe(403);
    });

    it('frees only the departing Spades seat at once when a guest leaves the room', async () => {
        const records = new Map(), actors = new Map(), connections = [];
        let now = 1000;
        const storage = {
            get: vi.fn(async key => structuredClone(records.get(key))),
            put: vi.fn(async (key, value) => {
                for (const [name, record] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) records.set(name, structuredClone(record));
            }),
            delete: vi.fn(async key => { records.delete(key); }),
            list: vi.fn(async ({ prefix = '' } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix))))
        };
        const tag = ARCADE_TAG + ':turdspades';
        function player(id, betaSid, canOpen) {
            actors.set(id, { betaSid, betaInviteVersion: 1, canPlay: true, canOpen, canJoin: subject => subject !== betaSid, canSee: () => true });
            let attachment = { actor: id, betaSid, betaInviteVersion: 1, room, ref, kind: tag };
            const socket = { frames: [], readyState: 1, serializeAttachment: data => { attachment = data; },
                deserializeAttachment: () => attachment, send(value) { this.frames.push(JSON.parse(value)); }, close: vi.fn() };
            connections.push(socket);
            return socket;
        }
        const host = player(actor, sid, true), west = player(guest, 'seat-west', false);
        const transport = createArcadeTransport({ name: 'turdspades', state: { storage, getWebSockets: () => connections },
            now: () => now, uuid: () => 'c8eb7f10-e113-418f-9900-7e23f4072497',
            current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
            charge: async () => true, allowed: () => true });
        const send = (socket, action, fields = {}) => transport.receive(socket, JSON.stringify({ version: 1, action, ...fields }));
        const board = socket => socket.frames.findLast(frame => frame.t === 'match-state')?.state;
        await send(host, 'open');
        const { id } = board(west);
        await send(west, 'join', { id, seat: 'west' });
        expect(board(west)).toMatchObject({ waiting: true, seat: 'west' });
        await transport.revoke({ room, ref }, 'seat-west');
        expect(board(host).occupied).not.toContain('west');
        expect(board(host)).toMatchObject({ id, waiting: true, seat: 'south' });
    });
});
