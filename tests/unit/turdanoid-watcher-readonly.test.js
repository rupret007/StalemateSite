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
    return { a, b, watcher, watcherBinding, send, state, records, now: () => now, setNow: value => { now = value; } };
}

function serialized(value) { return JSON.stringify(value); }
function containsPrivateData(value) {
    if (typeof value === 'string') return /private-hand-sentinel|private-card-sentinel/.test(value);
    if (Array.isArray(value)) return value.some(containsPrivateData);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => /^(hand|hands|deck|cards|privateHand|privateCards)$/i.test(key)
        || containsPrivateData(child));
}

describe('Turdanoid watch-only transport', () => {
    it('shows the public race to a null-seat watcher and refuses launch and steer while racers retain control', async () => {
        const f = fixture();
        await f.send(f.a, 'open');
        const id = f.state(f.a).id;
        await f.send(f.b, 'join', { id, seat: 'b' });
        f.watcherBinding.gameGuest.match = id;
        f.watcherBinding.gameGuest.tableId = f.state(f.a).tableId;
        const [storageKey, storedMatch] = [...f.records][0];
        f.records.set(storageKey, { ...storedMatch, privateHand: 'private-hand-sentinel', cards: ['private-card-sentinel'] });

        await f.send(f.watcher, undefined, { t: 'hello', lastSeq: 0 });
        const watched = f.state(f.watcher);
        expect(watched).toMatchObject({ id, seat: null, watchOnly: true, match: { game: 'turdanoid', players: expect.anything() } });
        // Watcher classification comes from its actual Game Night binding and remains
        // active through sync; no private seat projection is ever serialized.
        expect(f.watcherBinding.gameGuest).toMatchObject({ watch: true, match: id });
        const frames = f.watcher.frames;
        expect(frames.some(frame => frame.t === 'match-state' || frame.t === 'snapshot')).toBe(true);
        expect(frames.some(containsPrivateData)).toBe(false);
        expect(frames.every(frame => !containsPrivateData(frame.state ?? frame))).toBe(true);

        const beforeServe = serialized([...f.records]);
        await f.send(f.watcher, 'input', { id, sequence: 41, inputs: [[1, 'serve']] });
        expect(f.watcher.frames.at(-1)).toMatchObject({ t: 'match-error', reason: 'unavailable' });
        expect(serialized([...f.records])).toBe(beforeServe);
        await f.send(f.watcher, 'input', { id, sequence: 42, inputs: [[1, 'axis', 1]] });
        expect(f.watcher.frames.at(-1)).toMatchObject({ t: 'match-error', reason: 'unavailable' });
        expect(serialized([...f.records])).toBe(beforeServe);

        f.setNow(watched.match.startsAt + 10_000);
        const live = f.state(f.b).match;
        const inputTick = Math.floor((f.now() - live.startsAt) * 120 / 1000) + 1;
        const beforeRacerInput = serialized([...f.records]);
        const watcherFrameCount = f.watcher.frames.length;
        await f.send(f.b, 'input', { id, sequence: 1, inputs: [[inputTick, 'serve']] });
        expect(f.b.frames.at(-1).t).toBe('match-state');
        expect(serialized([...f.records])).not.toBe(beforeRacerInput);
        expect(f.watcher.frames.length).toBeGreaterThan(watcherFrameCount);
        expect(f.state(f.watcher).match).toMatchObject({
            game: f.state(f.b).match.game,
            startsAt: f.state(f.b).match.startsAt,
            tick: f.state(f.b).match.tick,
            players: f.state(f.b).match.players,
            result: f.state(f.b).match.result
        });
        await f.send(f.b, 'input', { id, sequence: 2, inputs: [[inputTick + 1, 'axis', 1]] });
        expect(f.b.frames.at(-1).t).toBe('match-state');
        expect(f.state(f.watcher).match).toMatchObject({
            game: f.state(f.b).match.game,
            startsAt: f.state(f.b).match.startsAt,
            tick: f.state(f.b).match.tick,
            players: f.state(f.b).match.players,
            result: f.state(f.b).match.result
        });
        expect(f.state(f.b).seat).toBe('b');
    });
});
