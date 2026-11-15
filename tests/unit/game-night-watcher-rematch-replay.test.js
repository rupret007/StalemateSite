// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';

const room = '#game-2ca9e1x1be34a';
const ref = '0'.repeat(32);
const actorId = index => 'c' + String(index + 1).repeat(32);
const sidFor = index => 'seat-' + index;

function fixture() {
    const records = new Map(), actors = new Map(), connections = [];
    let matchCount = 0;
    const storage = {
        getAlarm: async () => null, setAlarm: async () => {},
        get: async key => structuredClone(records.get(key)),
        put: async (key, value) => {
            for (const [entry, record] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) records.set(entry, structuredClone(record));
        },
        delete: async key => { for (const entry of [key].flat()) records.delete(entry); },
        list: async ({ prefix = '' } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix)))
    };
    function phone(index) {
        const id = actorId(index), betaSid = sidFor(index);
        if (!actors.has(id)) actors.set(id, { betaSid, betaInviteVersion: 1, canPlay: true, canOpen: index === 0,
            canJoin: subject => subject !== betaSid, canSee: () => true, isPresent: () => true });
        let attachment = { actor: id, betaSid, betaInviteVersion: 1, room, ref, kind: ARCADE_TAG + ':turdspades' };
        const socket = { frames: [], readyState: 1, serializeAttachment: data => { attachment = data; },
            deserializeAttachment: () => attachment, send(value) { this.frames.push(JSON.parse(value)); }, close() { this.readyState = 3; } };
        connections.push(socket);
        return socket;
    }
    const transport = createArcadeTransport({ state: { storage, getWebSockets: () => connections }, name: 'turdspades',
        now: () => 1000, uuid: () => 'c8eb7f10-e113-418f-9900-' + String(++matchCount).padStart(12, '0'),
        current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
        charge: async () => true, allowed: () => true });
    const send = (socket, action, fields = {}) => transport.receive(socket, JSON.stringify({ version: 1, action, ...fields }));
    const hello = socket => transport.receive(socket, JSON.stringify({ version: 1, t: 'hello', lastSeq: 0 }));
    const view = socket => socket.frames.findLast(frame => frame.t === 'match-state' || frame.t === 'snapshot')?.state;
    const drop = async socket => { socket.readyState = 3; await transport.presenceChanged(socket.deserializeAttachment()); };
    return { phone, send, hello, view, drop, actors };
}

async function fourPlayerTable() {
    const f = fixture(), players = Array.from({ length: 4 }, (_, index) => f.phone(index));
    for (const socket of players) await f.hello(socket);
    await f.send(players[0], 'open');
    const { id, tableId } = f.view(players[0]);
    for (const socket of players.slice(1)) await f.send(socket, 'join', { id, seat: 'next' });
    return { f, players, id, tableId };
}

describe('Game Night watcher reconnect and rematch transport', () => {
    it('reconnects a dropped watcher to a redacted read-only replay after a rematch', async () => {
        const { f, players, id, tableId } = await fourPlayerTable();
        const watcherIndex = 4;
        f.actors.set(actorId(watcherIndex), { betaSid: sidFor(watcherIndex), betaInviteVersion: 1, canPlay: true,
            canOpen: false, canJoin: subject => subject !== sidFor(watcherIndex), canSee: () => true,
            gameGuest: { room, ref, host: sidFor(0), match: id, tableId, game: 'turdspades', watch: true } });
        const watcher = f.phone(watcherIndex);
        await f.hello(watcher);
        expect(f.view(watcher)).toMatchObject({ watchOnly: true, seat: null, match: { hand: [] } });

        await f.drop(watcher);
        await f.send(players[0], 'resign', { id, revision: f.view(players[0]).match.revision ?? 0 });
        await f.send(players[0], 'start-rematch', { id });
        const next = f.view(players[0]).id;

        const returned = f.phone(watcherIndex);
        await f.hello(returned);
        expect(f.view(returned)).toMatchObject({ id: next, watchOnly: true, seat: null, match: { hand: [] } });
        expect(returned.frames.at(-1)).toMatchObject({ t: 'snapshot', currentMatchId: next, yourSeat: null, canOpen: false });
        expect(JSON.stringify(returned.frames)).not.toMatch(/"playable":|"hands":/);
        await f.send(returned, 'join', { id: next, seat: 'next' });
        expect(returned.frames.at(-1)).toMatchObject({ t: 'match-error' });
        expect(f.view(returned)).toMatchObject({ seat: null, match: { hand: [] } });
    });

    it('queues a fifth phone that joins after start-rematch without seating it or sending a hand', async () => {
        const { f, players, id } = await fourPlayerTable();
        await f.send(players[0], 'resign', { id, revision: f.view(players[0]).match.revision ?? 0 });
        await f.send(players[0], 'start-rematch', { id });
        const next = f.view(players[0]).id;
        const fifth = f.phone(4);
        await f.hello(fifth);

        expect(f.view(fifth)).toMatchObject({ id: next, seat: null, upNext: true, match: { hand: [] } });
        expect(fifth.deserializeAttachment().seat).toBeNull();
        expect(players.map(socket => f.view(socket).seat)).toEqual(['south', 'west', 'north', 'east']);
        expect(JSON.stringify(fifth.frames)).not.toMatch(/"playable":|"hands":/);
    });
});
