// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';

const room = '#game-2ca9e1x1be34a';
const ref = '0'.repeat(32);
const hostSid = 'seat-white';

function fixture() {
    const records = new Map(), actors = new Map(), connections = [];
    let matchCount = 0;
    const storage = {
        getAlarm: async () => null,
        setAlarm: async () => {},
        get: async key => structuredClone(records.get(key)),
        put: async (key, value) => records.set(key, structuredClone(value)),
        delete: async key => records.delete(key),
        list: async ({ prefix = '' } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix)))
    };
    function connect(id, betaSid, canOpen = false) {
        const binding = { betaSid, betaInviteVersion: 1, canPlay: true, canOpen,
            canJoin: subject => subject !== betaSid, canSee: () => true };
        actors.set(id, binding);
        const attachment = { actor: id, betaSid, betaInviteVersion: 1, room, ref, kind: ARCADE_TAG + ':turdspades' };
        const socket = { frames: [], readyState: 1, serializeAttachment(value) { this.attachment = value; },
            deserializeAttachment() { return this.attachment ?? attachment; },
            send(value) { this.frames.push(JSON.parse(value)); }, close: vi.fn() };
        connections.push(socket);
        return socket;
    }
    const host = connect('c' + '1'.repeat(32), hostSid, true);
    const guest = connect('c' + '2'.repeat(32), 'seat-west');
    const transport = createArcadeTransport({ state: { storage, getWebSockets: () => connections }, name: 'turdspades',
        current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
        charge: async () => true, allowed: () => true,
        uuid: () => 'c8eb7f10-e113-418f-9900-' + String(++matchCount).padStart(12, '0') });
    const send = (socket, action, fields = {}) => transport.receive(socket, JSON.stringify({ version: 1, action, ...fields }));
    const board = socket => socket.frames.findLast(frame => frame.t === 'match-state' || frame.t === 'snapshot')?.state;
    return { host, guest, connect, send, board, storage };
}

describe('offline next-game queue at seat open', () => {
    // Known bug: reopening after a queued guest disconnects leaves the newly opened seat empty.
    it.fails('skips an offline queued guest and seats the next connected guest on reopen', async () => {
        const f = fixture();
        const north = f.connect('c' + '3'.repeat(32), 'seat-north');
        const east = f.connect('c' + '4'.repeat(32), 'seat-east');
        const offlineActor = 'c' + '5'.repeat(32);
        const offline = f.connect(offlineActor, 'seat-offline');
        const next = f.connect('c' + '6'.repeat(32), 'seat-next');

        await f.send(f.host, 'open');
        const { id } = f.board(f.host);
        await f.send(f.guest, 'join', { id, seat: 'west' });
        await f.send(north, 'join', { id, seat: 'north' });
        await f.send(east, 'join', { id, seat: 'east' });
        await f.send(offline, 'sync');
        await f.send(next, 'sync');

        const tableKey = 'game-night-turdspades:' + ref;
        let checkpoint = await f.storage.get(tableKey);
        expect(checkpoint.turdspades.nextGame).toEqual(['seat-offline', 'seat-next']);

        // The queued guest has gone offline before the host opens the next table.
        offline.readyState = 3;
        await f.send(f.host, 'resign', { id, revision: f.board(f.host).match.revision ?? 0 });
        await f.send(east, 'leave', { id });
        await f.send(f.host, 'leave', { id });
        await f.send(f.host, 'open');

        checkpoint = await f.storage.get(tableKey);
        expect(checkpoint.turdspades.seats.east).toBe('seat-next');
        expect(Object.values(checkpoint.turdspades.seats)).not.toContain('seat-offline');
        expect(offline.frames.some(frame => frame.state?.match?.hand?.length)).toBe(false);

        // Returning later does not reveal a hand to the guest who missed the seat.
        const returned = f.connect(offlineActor, 'seat-offline');
        await f.send(returned, 'sync');
        expect(f.board(returned)).toMatchObject({ seat: null, match: null });
    });
});
