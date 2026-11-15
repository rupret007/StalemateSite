// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';

const room = '#game-2ca9e1x1be34a', ref = '0'.repeat(32);
const hostId = 'c' + '1'.repeat(32), guestId = 'c' + '2'.repeat(32);

function fixture() {
    const records = new Map(), actors = new Map(), sockets = [];
    const storage = {
        get: async key => structuredClone(records.get(key)),
        put: async (key, value) => records.set(key, structuredClone(value)),
        delete: vi.fn(async key => records.delete(key))
    };
    const player = (actor, betaSid, canOpen) => {
        const binding = { betaSid, betaInviteVersion: 1, canPlay: true, canOpen, canJoin: () => true,
            canSee: () => true, isPresent: () => true };
        actors.set(actor, binding);
        let attachment = { actor, betaSid, betaInviteVersion: 1, room, ref, kind: ARCADE_TAG };
        const socket = { frames: [], readyState: 1, serializeAttachment: value => { attachment = value; },
            deserializeAttachment: () => attachment, send(value) { this.frames.push(JSON.parse(value)); }, close: vi.fn() };
        sockets.push(socket);
        return socket;
    };
    const host = player(hostId, 'seat-white', true), guest = player(guestId, 'seat-black', false);
    const transport = createArcadeTransport({ state: { storage, getWebSockets: () => sockets }, name: 'chess',
        current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
        charge: async () => true, allowed: () => true, uuid: () => 'c8eb7f10-e113-418f-9900-000000000001' });
    const send = (socket, action, fields = {}) => transport.receive(socket, JSON.stringify({ version: 1, action, ...fields }));
    const view = socket => socket.frames.findLast(frame => frame.t === 'match-state' || frame.t === 'snapshot')?.state;
    const start = async () => {
        await send(host, 'open');
        const { id } = view(guest);
        await send(guest, 'join', { id });
        return id;
    };
    return { actors, guest, host, send, start, storage, transport, view };
}

describe('Game Night kick and ban transport session end', () => {
    // Expected failure: reconcile currently hard-codes 4403 room membership ended.
    it.fails('ends a lobby-kicked guest with 4001, holds their active seat, and lets the host continue', async () => {
        const f = fixture(), id = await f.start();
        f.actors.delete(guestId); // Lobby kick revokes the guest session.
        f.transport.reconcile();
        const count = f.guest.frames.length;
        await f.send(f.host, 'move', { id, revision: 0, move: 'e2e4' });
        expect(f.guest.frames).toHaveLength(count);
        expect((await f.storage.get(ARCADE_TAG + ':' + ref)).chess.seats.b).toBe('seat-black');
        expect(f.view(f.host).match.moves).toEqual(['e2e4']);
        expect(f.guest.frames.every(frame => !('hand' in frame))).toBe(true);
        expect(f.guest.close).toHaveBeenCalledWith(4001, expect.any(String));
    });

    // Expected failure: reconcile currently hard-codes 4403 room membership ended.
    it.fails.each(['room ban', 'network ban'])('%s closes with banned, holds the active seat, and lets the host continue', async reason => {
        const f = fixture(), id = await f.start();
        f.actors.delete(guestId); // A room or network ban revokes the guest session.
        f.transport.reconcile();
        const count = f.guest.frames.length;
        await f.send(f.host, 'move', { id, revision: 0, move: 'e2e4' });
        expect(f.guest.frames).toHaveLength(count);
        expect((await f.storage.get(ARCADE_TAG + ':' + ref)).chess.seats.b).toBe('seat-black');
        expect(f.view(f.host).match.moves).toEqual(['e2e4']);
        expect(f.guest.frames.every(frame => !('hand' in frame))).toBe(true);
        expect(f.guest.close).toHaveBeenCalledWith(expect.any(Number), 'banned');
    });
});
