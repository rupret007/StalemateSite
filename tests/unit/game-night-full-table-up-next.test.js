// @vitest-environment node
// Regression coverage for phones that arrive after every seat is occupied.
import { describe, expect, it } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';

const room = '#game-2ca9e1x1be34a';
const ref = '0'.repeat(32);
const games = [
    { label: 'Chess', name: 'chess', seats: 2, open: {}, privateHands: false },
    { label: 'partners Spades', name: 'turdspades', seats: 2, open: { mode: 'partners' }, privateHands: true },
    { label: 'four-player Spades', name: 'turdspades', seats: 4, open: {}, privateHands: true },
    { label: 'Turdanoid', name: 'turdanoid', seats: 2, open: {}, privateHands: false }
];

function fixture(name) {
    const records = new Map(), actors = new Map(), connections = [];
    let now = 1000, matchCount = 0, alarm = null;
    const storage = {
        getAlarm: async () => alarm,
        setAlarm: async at => { alarm = at; },
        get: async key => structuredClone(records.get(key)),
        put: async (key, value) => {
            for (const [entry, record] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) records.set(entry, structuredClone(record));
        },
        delete: async key => { for (const entry of [key].flat()) records.delete(entry); },
        list: async ({ prefix = '' } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix)))
    };
    function phone(index) {
        const id = 'c' + String(index + 1).repeat(32), betaSid = 'seat-' + index;
        if (!actors.has(id)) actors.set(id, { betaSid, betaInviteVersion: 1, canPlay: true, canOpen: index === 0,
            canJoin: subject => subject !== betaSid, canSee: () => true, isPresent: () => true });
        let attachment = { actor: id, betaSid, betaInviteVersion: 1, room, ref, kind: name === 'chess' ? ARCADE_TAG : ARCADE_TAG + ':' + name };
        const socket = { frames: [], readyState: 1, serializeAttachment: data => { attachment = data; },
            deserializeAttachment: () => attachment, send(value) { this.frames.push(JSON.parse(value)); }, close() { this.readyState = 3; } };
        connections.push(socket);
        return socket;
    }
    const transport = createArcadeTransport({ state: { storage, getWebSockets: () => connections }, name,
        now: () => now, uuid: () => 'c8eb7f10-e113-418f-9900-' + String(++matchCount).padStart(12, '0'),
        current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
        charge: async () => true, allowed: () => true });
    const send = (socket, action, fields = {}) => transport.receive(socket, JSON.stringify({ version: 1, action, ...fields }));
    const hello = socket => transport.receive(socket, JSON.stringify({ version: 1, t: 'hello', lastSeq: 0 }));
    const last = socket => socket.frames.findLast(frame => frame.t === 'match-state' || frame.t === 'snapshot');
    const view = socket => last(socket)?.state;
    return { phone, send, hello, last, view };
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

describe.each(games)('$label full-table up-next queue', game => {
    it('gives an extra phone a live read-only view and its place in line', async () => {
        const { f, phones, id } = await seated(game), extra = f.phone(game.seats);
        await f.hello(extra);
        expect(f.last(extra)).toMatchObject({ t: 'snapshot', phase: 'playing', currentMatchId: id, yourSeat: null });
        expect(f.view(extra)).toMatchObject({ seat: null, waiting: false, hasOpenSeat: false, upNext: true, match: expect.any(Object) });
        await f.send(extra, 'join', { id, seat: 'next' });
        expect(extra.frames.at(-1)).toEqual({ t: 'match-error', reason: 'seat-unavailable' });
        if (game.privateHands) {
            expect(f.view(extra).match.hand).toEqual([]);
            expect(JSON.stringify(extra.frames)).not.toMatch(/"playable":/);
            expect(JSON.stringify(extra.frames)).not.toContain(JSON.stringify(f.view(phones[0]).match.hand));
        }
    });

    it.fails('seats the first queued phone in the departed player’s place at rematch (gap: game-night-table.mjs:171)', async () => {
        const { f, phones, id, seats } = await seated(game), first = f.phone(game.seats);
        await f.hello(first);
        await resign(f, phones.at(-1));
        await f.send(phones.at(-1), 'leave', { id });
        await f.send(phones[0], 'start-rematch', { id });
        const nextId = f.view(phones[0]).id;
        expect(nextId).not.toBe(id);
        expect(f.last(first)).toMatchObject({ phase: 'playing', currentMatchId: nextId, yourSeat: seats.at(-1) });
        phones.slice(0, -1).forEach((socket, index) => expect(f.view(socket).seat).toBe(seats[index]));
        expect(f.view(first).seat).toBe(seats.at(-1));
    });

    it.fails('keeps two extra phones queued in arrival order through a vacancy (gap: game-night-table.mjs:171)', async () => {
        const { f, phones, id, seats } = await seated(game);
        const first = f.phone(game.seats), second = f.phone(game.seats + 1);
        await f.hello(first);
        await f.hello(second);
        expect(f.view(first)).toMatchObject({ seat: null, upNext: true });
        expect(f.view(second)).toMatchObject({ seat: null, upNext: true });
        await resign(f, phones.at(-1));
        await f.send(phones.at(-1), 'leave', { id });
        await f.send(phones[0], 'start-rematch', { id });
        const nextId = f.view(phones[0]).id;
        expect(f.last(first)).toMatchObject({ phase: 'playing', currentMatchId: nextId, yourSeat: seats.at(-1) });
        expect(f.view(second)).toMatchObject({ seat: null, upNext: true });
        expect(phones.slice(0, -1).map(socket => f.view(socket).seat)).toEqual(seats.slice(0, -1));
    });
});
