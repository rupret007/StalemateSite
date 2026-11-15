// @vitest-environment node
// Transport-level kick/ban before rematch for Chess and Spades (read-only src).
import { describe, expect, it } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';

const room = '#game-2ca9e1x1be34a';
const ref = '0'.repeat(32);
const actorId = index => 'c' + String(index + 1).repeat(32);
const sidFor = index => 'seat-' + index;

const cases = [
    {
        label: 'Chess',
        name: 'chess',
        open: {},
        seated: [0, 1],
        kickIndex: 1,
        banIndex: 2,
        privateHands: false
    },
    {
        label: 'Spades',
        name: 'turdspades',
        open: {},
        seated: [0, 1, 2, 3],
        kickIndex: 1,
        banIndex: 3,
        privateHands: true
    }
];

function fixture(name) {
    const records = new Map(), actors = new Map(), connections = [];
    let now = 1000, matchCount = 0, alarm = null;
    const tag = name === 'chess' ? ARCADE_TAG : ARCADE_TAG + ':' + name;
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
        const id = actorId(index), betaSid = sidFor(index);
        if (!actors.has(id)) {
            actors.set(id, { betaSid, betaInviteVersion: 1, canPlay: true, canOpen: index === 0,
                canJoin: subject => subject !== betaSid, canSee: () => true, isPresent: () => true });
        }
        let attachment = { actor: id, betaSid, betaInviteVersion: 1, room, ref, kind: tag };
        const socket = {
            frames: [], readyState: 1, closed: null,
            serializeAttachment: data => { attachment = data; },
            deserializeAttachment: () => attachment,
            send(value) { this.frames.push(JSON.parse(value)); },
            close(code, reason) { this.closed = { code, reason }; this.readyState = 3; }
        };
        connections.push(socket);
        return socket;
    }
    const transport = createArcadeTransport({
        state: { storage, getWebSockets: () => connections }, name,
        now: () => now, uuid: () => 'c8eb7f10-e113-418f-9900-' + String(++matchCount).padStart(12, '0'),
        current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
        charge: async () => true, allowed: () => true
    });
    const send = (socket, action, fields = {}) => transport.receive(socket, JSON.stringify({ version: 1, action, ...fields }));
    const hello = socket => transport.receive(socket, JSON.stringify({ version: 1, t: 'hello', lastSeq: 0 }));
    const last = socket => socket.frames.findLast(frame => frame.t === 'match-state' || frame.t === 'snapshot');
    const view = socket => last(socket)?.state;
    async function removeGuest(index, code, reason) {
        const id = actorId(index), betaSid = sidFor(index);
        const socket = connections.find(entry => entry.deserializeAttachment()?.actor === id);
        const boundary = socket.frames.length;
        actors.delete(id);
        socket.close(code, reason);
        await transport.revoke({ room, ref }, betaSid);
        transport.reconcile();
        return { socket, boundary, betaSid };
    }
    return { phone, send, hello, last, view, transport, removeGuest, advance: ms => { now += ms; } };
}

async function ready(game) {
    const f = fixture(game.name);
    const phones = [];
    for (const index of game.seated) phones[index] = f.phone(index);
    if (game.banIndex !== undefined && !game.seated.includes(game.banIndex)) phones[game.banIndex] = f.phone(game.banIndex);
    for (const socket of phones.filter(Boolean)) await f.hello(socket);
    await f.send(phones[0], 'open', game.open);
    const { id } = f.view(phones[0]);
    for (const index of game.seated.slice(1)) {
        await f.send(phones[index], 'join', { id, seat: 'next' });
    }
    const seats = game.seated.map(index => f.view(phones[index]).seat);
    return { f, phones, id, seats };
}

function postCloseFrames(socket, boundary) {
    return socket.frames.slice(boundary).filter(frame => frame.t !== 'match-error' || frame.reason !== 'unavailable');
}

function reportHandLeak(socket, boundary) {
    const tail = JSON.stringify(postCloseFrames(socket, boundary));
    return /"hand":\s*\[\s*\{|"playable":|"hands":\s*\[/.test(tail);
}

describe.each(cases)('Game Night kick/ban before rematch ($label)', game => {
    it('frees removed guests, keeps same seats for stayers, and sends no post-close frames or hand', async () => {
        const { f, phones, id, seats } = await ready(game);
        const stayers = game.seated.filter(index => index !== game.kickIndex && index !== game.banIndex);
        await f.send(phones[game.seated.at(-1)], 'resign', { id, revision: f.view(phones[game.seated.at(-1)]).match?.revision ?? 0 });
        for (const socket of game.seated.map(index => phones[index])) {
            expect(f.last(socket)).toMatchObject({ phase: 'finished', currentMatchId: id });
        }

        const kick = await f.removeGuest(game.kickIndex, 4001, 'kicked');
        const ban = await f.removeGuest(game.banIndex, 4003, 'banned');
        expect(kick.socket.closed).toEqual({ code: 4001, reason: 'kicked' });
        expect(ban.socket.closed).toEqual({ code: 4003, reason: 'banned' });

        for (const socket of [kick.socket, ban.socket]) {
            expect(postCloseFrames(socket, socket === kick.socket ? kick.boundary : ban.boundary)).toEqual([]);
        }
        if (game.privateHands) {
            expect(reportHandLeak(kick.socket, kick.boundary)).toBe(false);
            expect(reportHandLeak(ban.socket, ban.boundary)).toBe(false);
        }

        await f.send(phones[0], 'start-rematch', { id });
        const nextId = f.view(phones[0])?.id;
        expect(nextId).toBeTruthy();
        expect(nextId).not.toBe(id);

        for (const index of stayers) {
            const socket = phones[index];
            expect(socket.frames).toContainEqual({ t: 'rematch', matchId: nextId });
            expect(f.last(socket)).toMatchObject({ phase: 'playing', currentMatchId: nextId, yourSeat: seats[index] });
            expect(f.view(socket).match?.result ?? null).toBeNull();
        }

        const table = f.view(phones[0]);
        expect(table.occupied).toEqual(stayers.map(index => seats[index]));
        expect(table.occupied).not.toContain(seats[game.kickIndex]);
        if (game.seated.includes(game.banIndex)) expect(table.occupied).not.toContain(seats[game.banIndex]);

        for (const socket of [kick.socket, ban.socket]) {
            expect(postCloseFrames(socket, socket === kick.socket ? kick.boundary : ban.boundary)).toEqual([]);
            expect(socket.frames.some(frame => frame.t === 'rematch')).toBe(false);
            expect(f.view(socket) ?? null).toBeNull();
            if (game.privateHands) expect(reportHandLeak(socket, socket === kick.socket ? kick.boundary : ban.boundary)).toBe(false);
        }
    });
});