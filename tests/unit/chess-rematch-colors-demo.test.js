// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';

const room = '#chess-rematch-demo';
const ref = '1'.repeat(32);
const hostSubject = 'demo-host';
const guestSubject = 'demo-guest';
const watcherSubject = 'demo-watcher';

function fixture() {
    const records = new Map(), actors = new Map(), connections = [];
    let now = 1000, matchCount = 0;
    const storage = {
        getAlarm: async () => null,
        setAlarm: async () => {},
        get: async key => structuredClone(records.get(key)),
        put: async (key, value) => {
            for (const [recordKey, record] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) {
                records.set(recordKey, structuredClone(record));
            }
        },
        delete: async key => { records.delete(key); },
        list: async () => new Map(records)
    };
    function connect(actor, subject, canOpen, watch = false) {
        const binding = { betaSid: subject, betaInviteVersion: 1, canPlay: true, canOpen,
            canJoin: peer => peer !== subject, canSee: () => true,
            ...(watch ? { gameGuest: { watch: true } } : {}) };
        actors.set(actor, binding);
        let attachment = { actor, betaSid: subject, betaInviteVersion: 1, room, ref,
            kind: ARCADE_TAG };
        const socket = { frames: [], readyState: 1, serializeAttachment: data => { attachment = data; },
            deserializeAttachment: () => attachment, send(value) { this.frames.push(JSON.parse(value)); },
            close: vi.fn() };
        connections.push(socket);
        return socket;
    }
    const host = connect('demo-actor-host', hostSubject, true);
    const guest = connect('demo-actor-guest', guestSubject, false);
    const transport = createArcadeTransport({ state: { storage, getWebSockets: () => connections },
        current: scope => actors.get(scope.actor), active: async () => true,
        approve: async () => true, charge: async () => true, allowed: () => true,
        now: () => now,
        uuid: () => `c8eb7f10-e113-418f-9900-${String(++matchCount).padStart(12, '0')}` });
    const send = (socket, action, fields = {}) => transport.receive(socket,
        JSON.stringify({ version: 1, action, ...fields }));
    const board = socket => socket.frames.findLast(frame =>
        frame.t === 'match-state' || frame.t === 'snapshot')?.state;
    return { host, guest, actors, storage, send, board, connect, advance: ms => { now += ms; } };
}

describe('Chess rematch colour continuity demo', () => {
    it('resigns, rematches the same players in their existing colours, and leaves a watcher unseated', async () => {
        const f = fixture();
        await f.send(f.host, 'open');
        const originalId = f.board(f.guest).id;
        await f.send(f.guest, 'join', { id: originalId });

        // The host opens as white and the joining subject takes black.
        expect(f.board(f.host)).toMatchObject({ seat: 'w', match: { turn: 'w', moves: [] } });
        expect(f.board(f.guest)).toMatchObject({ seat: 'b', match: { turn: 'w', moves: [] } });
        await f.send(f.host, 'move', { id: originalId, revision: 0, move: 'e2e4' });
        await f.send(f.guest, 'move', { id: originalId, revision: 1, move: 'e7e5' });
        await f.send(f.host, 'resign', { id: originalId, revision: 2 });
        expect(f.board(f.host).match.result).toMatchObject({ winner: 'b', reason: 'Resignation' });

        const watcher = f.connect('demo-actor-watcher', watcherSubject, false, true);
        f.actors.get('demo-actor-watcher').gameGuest = {
            room, ref, host: hostSubject, match: originalId, tableId: originalId, game: 'chess', watch: true
        };
        await f.send(watcher, undefined, { t: 'hello', lastSeq: 0 });
        expect(f.board(watcher)).toMatchObject({ seat: null, watchOnly: true });
        await f.send(f.host, 'rematch', { id: originalId });
        expect(f.board(f.host).match.id).toBe(originalId);
        await f.send(f.guest, 'rematch', { id: originalId });

        const hostState = f.board(f.host);
        const guestState = f.board(f.guest);
        const watcherState = f.board(watcher);
        const saved = (await f.storage.get(`${ARCADE_TAG}:${ref}`)).chess;
        expect(saved.seats).toEqual({ w: hostSubject, b: guestSubject });
        expect(hostState).toMatchObject({ seat: 'w', match: { turn: 'w', moves: [], result: null } });
        expect(guestState).toMatchObject({ seat: 'b', match: { turn: 'w', moves: [], result: null } });
        expect(hostState.match.fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
        expect(hostState.match.id).not.toBe(originalId);
        expect(watcherState).toMatchObject({ seat: null, watchOnly: true, match: { moves: [] } });
        for (const frame of watcher.frames) {
            if (frame.t !== 'match-state' && frame.t !== 'snapshot') continue;
            expect(frame.state?.seat ?? null).toBeNull();
        }
    });
});