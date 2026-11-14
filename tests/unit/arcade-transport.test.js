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
    let now = 1000, matchCount = 0;
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
        now: () => now, uuid: () => 'c8eb7f10-e113-418f-9900-' + String(++matchCount).padStart(12, '0'),
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
    return { a, b, board, send, start, storage, actors, transport, advance: ms => { now += ms; } };
}

describe('Game Night match transport', () => {
    it('answers a seated player’s foreground probe without changing the match', async () => {
        const f = fixture();
        await f.start();
        const writes = f.storage.put.mock.calls.length, reads = f.storage.get.mock.calls.length;
        const hostFrames = f.a.frames.length;
        await f.send(f.b, 'ping', { nonce: 7 });
        expect(f.b.frames.at(-1)).toEqual({ t: 'pong', nonce: 7 });
        expect(f.storage.put).toHaveBeenCalledTimes(writes);
        expect(f.storage.get).toHaveBeenCalledTimes(reads);
        expect(f.a.frames).toHaveLength(hostFrames);
        f.actors.delete(guest);
        await f.send(f.b, 'ping', { nonce: 8 });
        expect(f.b.close).toHaveBeenCalledWith(4403, 'room membership ended');
        expect(f.b.frames.at(-1)).toEqual({ t: 'pong', nonce: 7 });
    });

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

    it('clears the host and guest match views when a read reaches the deadline before the alarm', async () => {
        const f = fixture();
        const { id } = await f.start();
        const checkpoint = await f.storage.get(ARCADE_TAG + ':' + ref);
        f.advance(checkpoint.expiresAt - 1000);

        expect(await f.transport.hasGuestSeat({ room, ref }, id, sid)).toBe(false);
        for (const socket of [f.a, f.b]) {
            expect(f.board(socket)).toBeNull();
            expect(socket.deserializeAttachment().subjects).toEqual([]);
        }
        const count = f.a.frames.length;
        await f.transport.maintain();
        expect(f.a.frames).toHaveLength(count);
    });

    it('sends one cleared match view when a guest sync reaches the deadline', async () => {
        const f = fixture();
        await f.start();
        const checkpoint = await f.storage.get(ARCADE_TAG + ':' + ref);
        f.advance(checkpoint.expiresAt - 1000);
        const count = f.b.frames.length;
        await f.send(f.b, 'sync');
        expect(f.board(f.a)).toBeNull();
        expect(f.b.frames.slice(count)).toEqual([expect.objectContaining({ t: 'match-state', state: null })]);
    });

    it('transfers a WebJam hold atomically and only admits its scoped session to the reserved match', async () => {
        const f = fixture();
        await f.send(f.a, 'open');
        const { id } = f.board(f.a);
        const scope = { room, ref, host: sid, match: id };
        const held = { holder: 'grant-hash', until: 61000, write: { grant: { kind: 'grant' } } };
        const move = { subject: f.actors.get(guest).betaSid, holder: held.holder, until: 61000, write: { grant: { kind: 'redeemed' } } };
        const bridge = f.transport.roomGrants;

        f.storage.put.mockRejectedValueOnce(Error('fixture failure'));
        await expect(bridge.hold(scope, held)).rejects.toThrow('fixture failure');
        expect(await f.storage.get('grant')).toBeUndefined();
        expect(f.board(f.a).hasOpenSeat).toBe(true);
        expect(await bridge.hold(scope, held)).toBe(true);
        await f.send(f.b, 'join', { id });
        expect(f.b.frames.at(-1)).toEqual({ t: 'match-error', reason: 'seat-unavailable' });

        f.storage.put.mockRejectedValueOnce(Error('fixture failure'));
        await expect(bridge.seat(scope, move)).rejects.toThrow('fixture failure');
        expect(await f.storage.get('grant')).toEqual(held.write.grant);
        expect(await bridge.seat(scope, move)).toBe('b');
        expect(await f.storage.get('grant')).toEqual(move.write.grant);
        f.actors.get(guest).gameGuest = { ...scope, match: 'other-match', game: 'chess' };
        await f.send(f.b, 'join', { id, seat: 'next' });
        expect(f.b.frames.at(-1)).toEqual({ t: 'match-error', reason: 'seat-unavailable' });
        f.actors.get(guest).gameGuest.match = id;
        await f.send(f.b, 'join', { id, seat: 'next' });
        expect(f.board(f.b)).toMatchObject({ id, seat: 'b', waiting: false });
    });

    it('lets an admitted guest join a replacement table from the same host only', async () => {
        const f = fixture();
        const { id } = await f.start();
        const binding = f.actors.get(guest);
        const invitation = { room, ref, host: sid, match: id, game: 'chess' };
        binding.gameGuest = invitation;
        await f.send(f.a, 'leave', { id });
        await f.send(f.a, 'open');
        const replacement = f.board(f.a).id;
        expect(replacement).not.toBe(id);

        for (const mismatch of [{ host: 'another-host' }, { ref: '9'.repeat(32) }, { room: '#game-418f99x990041' }, { game: 'turdspades' }]) {
            binding.gameGuest = { ...invitation, ...mismatch };
            await f.send(f.b, 'sync');
            expect(f.board(f.b)).not.toHaveProperty('replacementAvailable');
            await f.send(f.b, 'join', { id: replacement, seat: 'next' });
            expect(f.b.frames.at(-1)).toEqual({ t: 'match-error', reason: 'seat-unavailable' });
        }
        binding.gameGuest = invitation;
        await f.send(f.b, 'sync');
        expect(f.board(f.b)).toMatchObject({ id: replacement, waiting: true, replacementAvailable: true });
        const scope = { room, ref, host: sid, match: replacement };
        expect(await f.transport.reserveGuestSeat(scope, 'another-guest', 61000, 'invite', {})).toBe(true);
        await f.send(f.b, 'sync');
        expect(f.board(f.b).hasOpenSeat).toBe(false);
        expect(f.board(f.b)).not.toHaveProperty('replacementAvailable');
        await f.send(f.b, 'join', { id: replacement, seat: 'next' });
        expect(f.b.frames.at(-1)).toEqual({ t: 'match-error', reason: 'seat-unavailable' });
        await f.transport.releaseGuestClaim(scope, 'another-guest');
        expect(f.board(f.b)).toMatchObject({ id: replacement, waiting: true, replacementAvailable: true });
        await f.send(f.b, 'join', { id: replacement, seat: 'next' });
        expect(f.board(f.b)).toMatchObject({ id: replacement, seat: 'b', waiting: false });
    });

    it('expires a room grant before opening a socket', async () => {
        const f = fixture(), session = { betaSid: sid, betaInviteVersion: 1 };
        const response = await f.transport.issue({ actor, room, ref }, session);
        const { ticket, protocol, expiresInMs } = await response.json();
        expect(response.status).toBe(200);
        f.advance(expiresInMs);
        expect((await f.transport.upgrade(`${protocol}, ${ticket}`, session)).status).toBe(403);
    });
});
