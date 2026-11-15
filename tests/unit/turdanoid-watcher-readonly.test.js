// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';

const room = '#game-2ca9e1x1be34a';
const ref = '0'.repeat(32);
const host = 'c' + '1'.repeat(32);
const racer = 'c' + '2'.repeat(32);
const watcherId = 'c' + '3'.repeat(32);

function fixture() {
    const records = new Map(), actors = new Map(), connections = [];
    const storage = {
        get: async key => structuredClone(records.get(key)),
        put: async (key, value) => { records.set(key, structuredClone(value)); },
        delete: async key => { records.delete(key); },
        list: async ({ prefix = '' } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix))),
        getAlarm: async () => null,
        setAlarm: async () => {}
    };
    function connect(id, betaSid, canOpen = false) {
        const binding = { betaSid, betaInviteVersion: 1, canPlay: true, canOpen,
            canJoin: () => true, canSee: () => true };
        actors.set(id, binding);
        let attachment = { actor: id, betaSid, betaInviteVersion: 1, room, ref,
            kind: 'game-night-match:turdanoid' };
        const socket = { frames: [], readyState: 1,
            serializeAttachment: data => { attachment = data; },
            deserializeAttachment: () => attachment,
            send(value) { this.frames.push(JSON.parse(value)); } };
        connections.push(socket);
        return socket;
    }
    const a = connect(host, 'seat-host', true);
    const b = connect(racer, 'seat-racer');
    const watcher = connect(watcherId, 'seat-watch');
    const watcherBinding = actors.get(watcherId);
    watcherBinding.gameGuest = { room, ref, host: 'seat-host', match: '', tableId: 'table-1', game: 'turdanoid', watch: true };
    let now = 1000;
    const transport = createArcadeTransport({ state: { storage, getWebSockets: () => connections }, name: 'turdanoid',
        current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
        charge: async () => true, allowed: () => true, now: () => now,
        uuid: () => 'race-12345' });
    const send = (socket, action, fields = {}) => transport.receive(socket,
        JSON.stringify({ version: 1, action, ...fields }));
    const state = socket => socket.frames.findLast(frame => frame.t === 'match-state' || frame.t === 'snapshot')?.state;
    return { a, b, watcher, watcherBinding, send, state, now: () => now, setNow: value => { now = value; } };
}

describe('Turdanoid watch-only transport', () => {
    it('shows the public race to a null-seat watcher and refuses launch and steer while racers retain control', async () => {
        const f = fixture();
        await f.send(f.a, 'open');
        const id = f.state(f.a).id;
        await f.send(f.b, 'join', { id, seat: 'b' });
        f.watcherBinding.gameGuest.match = id;
        f.watcherBinding.gameGuest.tableId = f.state(f.a).tableId;

        await f.send(f.watcher, undefined, { t: 'hello', lastSeq: 0 });
        const watched = f.state(f.watcher);
        expect(watched).toMatchObject({ id, seat: null, watchOnly: true, match: { game: 'turdanoid', players: expect.anything() } });

        const race = watched.match;
        await f.send(f.watcher, 'input', { id, sequence: 1, inputs: [[1, 'serve']] });
        expect(f.watcher.frames.at(-1)).toMatchObject({ t: 'match-error', reason: 'unavailable' });
        await f.send(f.watcher, 'input', { id, sequence: 1, inputs: [[1, 'axis', 1]] });
        expect(f.watcher.frames.at(-1)).toMatchObject({ t: 'match-error', reason: 'unavailable' });

        f.setNow(race.startsAt + 10_000);
        const live = f.state(f.b).match;
        const inputTick = Math.floor((f.now() - live.startsAt) * 120 / 1000) + 1;
        await f.send(f.b, 'input', { id, sequence: 1, inputs: [[inputTick, 'serve']] });
        expect(f.b.frames.at(-1).t).not.toBe('match-error');
        await f.send(f.b, 'input', { id, sequence: 2, inputs: [[inputTick + 1, 'axis', 1]] });
        expect(f.b.frames.at(-1).t).not.toBe('match-error');
        expect(f.state(f.b).seat).toBe('b');
    });
});
