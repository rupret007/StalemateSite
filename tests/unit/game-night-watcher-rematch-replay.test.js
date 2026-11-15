// @vitest-environment node
// Focused watcher replay coverage using the in-memory arcade transport shape
// exercised by family-alpha-gate.test.js and arcade-transport.test.js.
import { describe, expect, it } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';

const room = '#game-2ca9e1x1be34a';
const ref = '0'.repeat(32);
const actorId = index => 'c' + String(index + 1).repeat(32);
const sidFor = index => 'seat-' + index;
const games = [
    { label: 'partners Spades', name: 'turdspades', seats: 2, open: { mode: 'partners' } },
    { label: 'four-player Spades', name: 'turdspades', seats: 4, open: {} }
];

function fixture(name) {
    const records = new Map(), actors = new Map(), connections = [];
    let matchCount = 0;
    const storage = {
        getAlarm: async () => null, setAlarm: async () => {},
        get: async key => structuredClone(records.get(key)),
        put: async (key, value) => { for (const [entry, record] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) records.set(entry, structuredClone(record)); },
        delete: async key => { for (const entry of [key].flat()) records.delete(entry); },
        list: async ({ prefix = '' } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix)))
    };
    function phone(index) {
        const id = actorId(index), betaSid = sidFor(index);
        if (!actors.has(id)) actors.set(id, { betaSid, betaInviteVersion: 1, canPlay: true, canOpen: index === 0,
            canJoin: subject => subject !== betaSid, canSee: () => true, isPresent: () => true });
        let attachment = { actor: id, betaSid, betaInviteVersion: 1, room, ref, kind: ARCADE_TAG + ':' + name };
        const socket = { frames: [], readyState: 1, serializeAttachment: data => { attachment = data; },
            deserializeAttachment: () => attachment, send(value) { this.frames.push(JSON.parse(value)); }, close() { this.readyState = 3; } };
        connections.push(socket);
        return socket;
    }
    const transport = createArcadeTransport({ state: { storage, getWebSockets: () => connections }, name,
        now: () => 1000, uuid: () => 'c8eb7f10-e113-418f-9900-' + String(++matchCount).padStart(12, '0'),
        current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
        charge: async () => true, allowed: () => true });
    const send = (socket, action, fields = {}) => transport.receive(socket, JSON.stringify({ version: 1, action, ...fields }));
    const hello = socket => transport.receive(socket, JSON.stringify({ version: 1, t: 'hello', lastSeq: 0 }));
    const last = socket => socket.frames.findLast(frame => frame.t === 'match-state' || frame.t === 'snapshot');
    const view = socket => last(socket)?.state;
    const drop = async socket => { socket.readyState = 3; await transport.presenceChanged(socket.deserializeAttachment()); };
    return { phone, send, hello, last, view, drop, binding: index => actors.get(actorId(index)) };
}

async function seated(game) {
    const f = fixture(game.name), phones = Array.from({ length: game.seats }, (_, index) => f.phone(index));
    for (const socket of phones) await f.hello(socket);
    await f.send(phones[0], 'open', game.open);
    const { id } = f.view(phones[0]);
    for (const socket of phones.slice(1)) await f.send(socket, 'join', { id, seat: 'next' });
    return { f, phones, id, seats: phones.map(socket => f.view(socket).seat) };
}
const resign = (f, socket) => f.send(socket, 'resign', { id: f.view(socket).id, revision: f.view(socket).match.revision ?? 0 });

describe.each(games)('watcher rematch replay: $label', game => {
    async function watcherFixture() {
        const state = await seated(game), index = game.seats;
        const { tableId } = state.f.view(state.phones[0]);
        const watcher = state.f.phone(index);
        state.f.binding(index).gameGuest = { room, ref, host: sidFor(0), match: state.id, tableId, game: game.name, watch: true };
        await state.f.hello(watcher);
        return { ...state, watcher };
    }
    const assertPrivateFree = watcher => {
        expect(watcher.frames.at(-1)).toMatchObject({ t: 'snapshot', yourSeat: null });
        expect(watcher.frames.at(-1).state).toMatchObject({ seat: null, watchOnly: true });
        expect(watcher.frames.at(-1).state.match.hand).toEqual([]);
        expect(JSON.stringify(watcher.frames)).not.toMatch(/"playable":|"hands":/);
        for (let id = 0; id < 52; id++) expect(JSON.stringify(watcher.frames)).not.toMatch(new RegExp('"' + id + '"'));
    };

    it('reconnects after a mid-hand socket drop with public state only and no seat', async () => {
        const { f, phones, watcher } = await watcherFixture();
        const before = f.view(watcher).match;
        expect(before.hand).toEqual([]);
        await f.drop(watcher);
        const returned = f.phone(game.seats);
        await f.hello(returned);
        assertPrivateFree(returned);
        expect(returned.frames.at(-1).state.match).toBeTruthy();
        expect(returned.frames.at(-1).state.match.hand).toEqual([]);
        expect(phones.every(socket => Boolean(f.view(socket).seat))).toBe(true);
    });

    it('keeps watcher unseated and card-free when all seated players request rematch', async () => {
        const { f, phones, id, seats, watcher } = await watcherFixture();
        await resign(f, phones.at(-1));
        await f.send(phones.at(-1), 'rematch', { id });
        for (const socket of phones.slice(0, -1)) await f.send(socket, 'rematch', { id });
        const next = f.view(phones[0]).id;
        expect(next).not.toBe(id);
        expect(phones.map(socket => f.view(socket).seat)).toEqual(seats);
        assertPrivateFree(watcher);
        expect(f.view(watcher).match.hand).toEqual([]);
    });

    it('keeps a phone arriving after start-rematch read-only on the full table', async () => {
        const { f, phones, id, seats } = await seated(game);
        await resign(f, phones.at(-1));
        await f.send(phones[0], 'start-rematch', { id });
        const extra = f.phone(game.seats);
        await f.hello(extra);
        expect(f.last(extra)).toMatchObject({ t: 'snapshot', phase: 'playing', yourSeat: null });
        expect(f.view(extra)).toMatchObject({ seat: null, waiting: false, hasOpenSeat: false });
        expect(f.view(extra).match.hand).toEqual([]);
        expect(phones.map(socket => f.view(socket).seat)).toEqual(seats);
        expect(JSON.stringify(extra.frames)).not.toMatch(/"playable":|"hands":/);
    });
});
