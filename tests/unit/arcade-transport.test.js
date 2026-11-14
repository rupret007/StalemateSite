// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';
import { readGameNightPass } from '../../hangout-worker/src/game-night-pass.mjs';
import { GAME_NIGHT_LENGTH } from '../../hangout-worker/src/game-night-lifetime.mjs';

const room = '#game-2ca9e1x1be34a';
const ref = '0'.repeat(32);
const sid = 'seat-white';
const actor = 'c' + '1'.repeat(32);
const guest = 'c' + '2'.repeat(32);

function fixture(name = 'chess') {
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
        let attachment = { actor: id, betaSid, betaInviteVersion: 1, room, ref, kind: name === 'chess' ? ARCADE_TAG : ARCADE_TAG + ':' + name };
        const socket = { frames: [], readyState: 1, serializeAttachment: data => { attachment = data; },
            deserializeAttachment: () => attachment, send(value) { this.frames.push(JSON.parse(value)); },
            close: vi.fn() };
        connections.push(socket);
        return socket;
    }
    const a = player(actor, sid, true), b = player(guest, 'seat-black', false);
    const guestActivity = vi.fn(async () => {});
    const transport = createArcadeTransport({ state: { storage, getWebSockets: () => connections }, name, guestActivity,
        now: () => now, uuid: () => 'c8eb7f10-e113-418f-9900-' + String(++matchCount).padStart(12, '0'),
        current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
        charge: async () => true, allowed: () => true });
    const send = (socket, action, fields = {}) => transport.receive(socket, JSON.stringify({ version: 1, action, ...fields }));
    const board = socket => socket.frames.findLast(frame => frame.t === 'match-state' || frame.t === 'snapshot')?.state;
    const start = async () => {
        await send(a, 'open');
        const { id } = board(b);
        await send(b, 'join', { id });
        return { id, revision: 0, move: 'e2e4' };
    };
    return { a, b, board, send, start, storage, actors, transport, guestActivity, advance: ms => { now += ms; } };
}

describe('Game Night match transport', () => {
    it('negotiates snapshots per socket and includes the confirmed seat and turn', async () => {
        const f = fixture(), move = await f.start();
        await f.send(f.b, undefined, { t: 'hello', lastSeq: 0 });
        const initial = f.b.frames.at(-1);
        expect(initial).toMatchObject({
            t: 'snapshot', seq: expect.any(Number), phase: 'playing',
            currentMatchId: move.id, yourSeat: 'b', turn: 'w'
        });
        expect(f.b.deserializeAttachment()).toMatchObject({ playerId: 'seat-black', seat: 'b' });
        await f.send(f.a, 'move', move);
        expect(f.a.frames.at(-1).t).toBe('match-state');
        const moved = f.b.frames.at(-1);
        expect(moved).toMatchObject({ t: 'snapshot', currentMatchId: move.id, yourSeat: 'b', turn: 'b' });
        expect(moved.seq).toBe(initial.seq + 1);
    });

    it('reports a hidden match as open, never as a lobby, when a block clears a seated view', async () => {
        const f = fixture();
        const { id } = await f.start();
        await f.send(f.a, undefined, { t: 'hello', lastSeq: 0 });
        const { seq } = f.a.frames.at(-1);
        f.actors.get(actor).canSee = subject => subject === sid;
        f.transport.reconcile();
        // The board stays hidden, but the open match is not described as "no table yet".
        expect(f.a.frames.at(-1)).toMatchObject({
            t: 'snapshot', seq, phase: 'playing', currentMatchId: id, yourSeat: null, turn: null, state: null
        });
        expect(f.a.deserializeAttachment()).toMatchObject({ seat: null, subjects: [] });
        const before = f.a.frames.length;
        await f.send(f.a, undefined, { t: 'hello', lastSeq: seq });
        expect(f.a.frames.slice(before)).toEqual([f.a.frames[before - 1]]);
        // A change published while the view is hidden keeps saying so.
        await f.send(f.b, 'resign', { id, revision: 0 });
        expect(f.a.frames.at(-1)).toMatchObject({
            t: 'snapshot', phase: 'finished', currentMatchId: id, yourSeat: null, state: null
        });
    });

    it('still says lobby when the host has closed the table', async () => {
        const f = fixture();
        const { id } = await f.start();
        await f.send(f.b, undefined, { t: 'hello', lastSeq: 0 });
        await f.send(f.a, 'leave', { id });
        expect(f.b.frames.at(-1)).toMatchObject({ t: 'snapshot', phase: 'lobby', currentMatchId: null, state: null });
    });

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

    it('commits only the table-scoped hash with the seat and binds hello to its guest', async () => {
        const f = fixture();
        await f.send(f.a, 'open');
        const { id } = f.board(f.a);
        const scope = { room, ref, host: sid, match: id, tableId: id, game: 'chess' };
        const pass = '7'.repeat(64);
        const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass))).toString('hex');
        const accepted = { scope, sid: 'seat-black', exp: 60000, version: '1' };
        expect(await f.transport.reserveGuestSeat(scope, accepted.sid, 59000, 'invite', accepted, hash)).toBe(true);
        const [write] = f.storage.put.mock.calls.at(-1);
        expect(JSON.stringify(write)).not.toContain(pass);
        expect(await readGameNightPass(f.storage, id, pass)).toEqual(accepted);
        expect(await readGameNightPass(f.storage, '14111111-1111-4111-8111-111111111111', pass)).toBeUndefined();
        f.actors.get(guest).gameGuest = scope;
        await f.send(f.b, undefined, { t: 'hello', lastSeq: 0, pass });
        expect(f.b.frames.at(-1)).toMatchObject({ t: 'snapshot', phase: 'lobby' });
        await f.send(f.a, undefined, { t: 'hello', lastSeq: 0, pass });
        expect(f.a.close).toHaveBeenCalledWith(4403, 'table pass unavailable');
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
        expect(await f.storage.getAlarm()).toBe(61000);
        f.advance(60000);
        await f.transport.maintain();
        expect(await f.storage.getAlarm()).toBe(1000 + GAME_NIGHT_LENGTH);
        expect(f.board(f.a)).toMatchObject({ id, waiting: true, hasOpenSeat: true });
        await f.send(f.b, 'join', { id });
        expect(f.board(f.b)).toMatchObject({ id, seat: 'b' });
    });

    it('keeps the original night deadline through a rematch and host reopen', async () => {
        const f = fixture(), { id } = await f.start();
        const scope = { room, ref, tableId: id, host: sid };
        const end = 1000 + GAME_NIGHT_LENGTH;
        expect(await f.transport.guestNightEndsAt(scope)).toBe(end);
        expect(await f.transport.guestNightEndsAt({ ...scope, host: 'different-host' })).toBe(0);
        f.advance(2000);
        await f.send(f.b, 'resign', { id, revision: 0 });
        await f.send(f.a, 'start-rematch', { id });
        const next = f.board(f.a).id;
        expect(next).not.toBe(id);
        expect(await f.transport.guestNightEndsAt(scope)).toBe(end);
        await f.send(f.a, 'leave', { id: next });
        await f.send(f.a, 'open');
        expect(f.board(f.a)).toMatchObject({ tableId: id, seat: 'w' });
        expect(await f.storage.getAlarm()).toBe(end);
        expect(await f.transport.guestNightEndsAt(scope)).toBe(end);
        f.advance(GAME_NIGHT_LENGTH - 2000);
        await f.transport.maintain();
        expect(f.board(f.a)).toBeNull();
        expect(f.board(f.b)).toBeNull();
    });

    it('counts confirmed guest play toward idle, while sync and refused moves leave it alone', async () => {
        const f = fixture(), { id } = await f.start();
        const binding = f.actors.get(guest);
        binding.gameGuest = { room, ref, host: sid, match: id, tableId: id, game: 'chess' };
        await f.send(f.b, 'sync');
        await f.send(f.b, 'move', { id, revision: 0, move: 'e7e5' });
        expect(f.guestActivity).not.toHaveBeenCalled();
        await f.send(f.a, 'move', { id, revision: 0, move: 'e2e4' });
        const move = { id, revision: 1, move: 'e7e5' };
        f.storage.put.mockRejectedValueOnce(Error('match write failed'));
        await f.send(f.b, 'move', move);
        expect(f.b.frames.at(-1)).toMatchObject({ t: 'match-error', reason: 'storage-unavailable' });
        expect(f.guestActivity).not.toHaveBeenCalled();

        f.guestActivity.mockRejectedValueOnce(Error('registry unavailable'));
        await f.send(f.b, 'move', move);
        expect(f.guestActivity).toHaveBeenCalledExactlyOnceWith(binding);
        expect(f.board(f.a).match.moves).toEqual(['e2e4', 'e7e5']);
        expect(f.b.frames.at(-1).t).toBe('match-state');
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

    it('offers a replacement to an unseated guest only if the same host has room', async () => {
        const f = fixture();
        await f.send(f.a, 'open');
        const { id } = f.board(f.a);
        const binding = f.actors.get(guest);
        binding.gameGuest = { room, ref, host: sid, match: id, game: 'chess' };
        await f.send(f.a, 'leave', { id });
        await f.send(f.a, 'open');
        const replacement = f.board(f.a).id;
        expect(f.board(f.b)).toMatchObject({ id: replacement, replacementAvailable: true, hasOpenSeat: true });
        const scope = { room, ref, host: sid, match: replacement };
        expect(await f.transport.reserveGuestSeat(scope, 'another-guest', 61000, 'invite', {})).toBe(true);
        expect(f.board(f.b)).toMatchObject({ id: replacement, hasOpenSeat: false });
        expect(f.board(f.b)).not.toHaveProperty('replacementAvailable');
        await f.transport.releaseGuestClaim(scope, 'another-guest');
        expect(f.board(f.b)).toMatchObject({ id: replacement, replacementAvailable: true, hasOpenSeat: true });
        await f.send(f.b, 'join', { id: replacement, seat: 'next' });
        expect(f.board(f.b)).toMatchObject({ id: replacement, seat: 'b', waiting: false });
    });

    it.each([['partners', 'partners'], [undefined, 'four']])('offers only the saved Spades mode with a roster (%s)', async (mode, reopenMode) => {
        const f = fixture('turdspades');
        await f.send(f.a, 'open', mode ? { mode } : {});
        const { id, tableId } = f.board(f.a);
        await f.send(f.b, 'join', { id, seat: 'west' });
        expect(f.board(f.b)).toMatchObject({ seat: 'west' });
        await f.send(f.a, 'leave', { id });
        expect(f.a.frames.at(-1)).toMatchObject({ state: null, reopenMode });
        expect(f.b.frames.at(-1)).not.toHaveProperty('reopenMode');
        await f.send(f.a, 'open', mode ? {} : { mode: 'partners' });
        expect(f.a.frames.at(-1)).toMatchObject({ t: 'match-error', reason: 'unavailable' });
        await f.send(f.a, 'open', mode ? { mode } : {});
        expect(f.board(f.b)).toMatchObject({ tableId, seat: 'west' });
        expect(f.board(f.b).id).not.toBe(id);
    });

    it('preserves the table identity and roster when the host reopens, and makes a duplicate join idempotent', async () => {
        const f = fixture();
        const { id } = await f.start();
        const invitation = { room, ref, host: sid, match: id, tableId: id, game: 'chess' };
        f.actors.get(guest).gameGuest = invitation;
        await f.send(f.b, undefined, { t: 'hello', lastSeq: 0 });
        await f.send(f.a, 'leave', { id });
        expect(f.b.frames.at(-1)).toMatchObject({
            t: 'snapshot', phase: 'lobby', currentMatchId: null, yourSeat: 'b', turn: null, state: null
        });
        const writes = f.storage.put.mock.calls.length;
        await f.send(f.b, 'join', { id, seat: 'next' });
        expect(f.b.frames.at(-1)).toMatchObject({ t: 'snapshot', phase: 'lobby', yourSeat: 'b', currentMatchId: null });
        expect(f.storage.put.mock.calls).toHaveLength(writes);
        await f.send(f.a, 'open');
        const replacement = f.board(f.a).id;
        expect(replacement).not.toBe(id);
        expect(f.b.frames.at(-1)).toMatchObject({
            t: 'snapshot', currentMatchId: replacement, yourSeat: 'b', state: { tableId: id, seat: 'b', waiting: false }
        });
        expect(f.b.deserializeAttachment()).toMatchObject({ playerId: 'seat-black', seat: 'b' });
        const before = f.storage.put.mock.calls.length;
        await f.send(f.b, 'join', { id, seat: 'next' });
        expect(f.b.frames.at(-1).t).toBe('snapshot');
        expect(f.storage.put.mock.calls).toHaveLength(before);

    });

    it.each([
        { host: 'different-host' },
        { game: 'turdspades' },
        { room: '#game-dead00xdead00' },
        { ref: '1'.repeat(32) },
        { tableId: 'c8eb7f10-e113-418f-9900-000000000999' }
    ])('does not expose a live table to a mismatched guest scope (%j)', async override => {
        const f = fixture();
        const { id } = await f.start();
        const before = f.storage.put.mock.calls.length;
        f.actors.get(guest).gameGuest = { room, ref, host: sid, match: id, tableId: id, game: 'chess', ...override };
        await f.send(f.b, undefined, { t: 'hello', lastSeq: 0 });
        expect(f.b.frames.at(-1)).toMatchObject({ t: 'snapshot', phase: 'unavailable', state: null, yourSeat: null, currentMatchId: null });
        expect(f.b.deserializeAttachment()).toMatchObject({ seat: null, subjects: [] });
        await f.send(f.b, 'move', { id, revision: 0, move: 'e7e5' });
        expect(f.b.frames.at(-1)).toMatchObject({ t: 'match-error', reason: 'unavailable' });
        expect(f.storage.put.mock.calls).toHaveLength(before);
    });

    it('returns an authoritative snapshot and starts a rematch with a closed phone on the roster', async () => {
        const f = fixture();
        const { id } = await f.start();
        await f.send(f.b, 'resign', { id, revision: 0 });
        f.b.readyState = 3;
        const host = f.actors.get(actor);
        host.canSee = subject => subject === sid;
        host.isPresent = subject => subject === sid;
        f.transport.reconcile();
        await f.send(f.a, 'rematch', { id });
        const rematch = f.a.frames.findLast(frame => frame.t === 'rematch');
        expect(rematch?.matchId).toBeTruthy();
        expect(rematch.matchId).not.toBe(id);
        expect(f.board(f.a)).toMatchObject({ tableId: id, seat: 'w', disconnectedSeats: ['b'] });

        f.b.readyState = 1;
        await f.send(f.b, undefined, { t: 'hello', lastSeq: 1 });
        expect(f.b.frames.at(-1)).toMatchObject({
            t: 'snapshot', seq: expect.any(Number), phase: 'playing', currentMatchId: rematch.matchId,
            yourSeat: 'b', turn: 'w', state: { tableId: id, disconnectedSeats: [] }
        });
    });

    it('starts a requested rematch when the unready phone disconnects', async () => {
        const f = fixture();
        const { id } = await f.start();
        await f.send(f.b, 'resign', { id, revision: 0 });
        await f.send(f.a, 'rematch', { id });
        expect(f.board(f.a)).toMatchObject({ id, rematch: 'w' });
        const closed = f.b.deserializeAttachment();
        f.b.readyState = 3;
        await f.transport.presenceChanged(closed);
        const rematch = f.a.frames.findLast(frame => frame.t === 'rematch');
        expect(rematch?.matchId).not.toBe(id);
        expect(f.board(f.a)).toMatchObject({ id: rematch.matchId, tableId: id, seat: 'w', disconnectedSeats: ['b'] });
    });

    it('starts a ready rematch if a replacement phone socket closes before its first snapshot', async () => {
        const f = fixture();
        const { id } = await f.start();
        await f.send(f.b, 'resign', { id, revision: 0 });
        await f.send(f.a, 'rematch', { id });

        const oldSocket = f.b.deserializeAttachment();
        const { seat: _seat, subjects: _subjects, ...attachment } = oldSocket;
        f.b.serializeAttachment(attachment);
        await f.transport.presenceChanged({ ...oldSocket, retired: true });
        expect(f.board(f.a)).toMatchObject({ id, rematch: 'w', disconnectedSeats: [] });

        f.b.readyState = 3;
        await f.transport.presenceChanged(attachment);
        const rematch = f.a.frames.findLast(frame => frame.t === 'rematch');
        expect(rematch?.matchId).toBeTruthy();
        expect(f.board(f.a)).toMatchObject({ id: rematch.matchId, seat: 'w', disconnectedSeats: ['b'] });

        f.b.readyState = 1;
        await f.send(f.b, undefined, { t: 'hello', lastSeq: 0 });
        expect(f.b.frames.at(-1)).toMatchObject({ t: 'snapshot', currentMatchId: rematch.matchId, yourSeat: 'b' });
    });

    it('only lets the table host start a rematch before the other seat is ready', async () => {
        const f = fixture();
        const { id } = await f.start();
        await f.send(f.b, 'resign', { id, revision: 0 });
        await f.send(f.b, 'start-rematch', { id });
        expect(f.b.frames.at(-1)).toMatchObject({ t: 'match-error', reason: 'rematch-unavailable' });
        expect(f.board(f.a).id).toBe(id);
        await f.send(f.a, 'start-rematch', { id });
        const rematch = f.b.frames.findLast(frame => frame.t === 'rematch');
        expect(rematch?.matchId).toBeTruthy();
        expect(f.board(f.b)).toMatchObject({ id: rematch.matchId, tableId: id, seat: 'b' });
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
