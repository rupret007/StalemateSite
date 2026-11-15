// @vitest-environment node
// Transport-level kick/ban before rematch for Chess, Spades, and partner Spades.
import { describe, expect, it } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';
import { GameNightTurdJack } from '../../hangout-worker/src/game-night-turdjack.mjs';

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
    },
    {
        label: 'Spades partners',
        name: 'turdspades',
        open: { mode: 'partners' },
        seated: [0, 1],
        kickIndex: 1,
        banIndex: 2,
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
    function watch(index) {
        const socket = phone(index);
        const actor = actors.get(actorId(index));
        actor.canPlay = false;
        actor.canOpen = false;
        actor.gameGuest = { watch: true, game: name, room, ref, host: sidFor(0) };
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
    const prefix = name === 'chess' ? ARCADE_TAG + ':' : 'game-night-' + name + ':';
    const saved = () => records.get(prefix + ref)?.[name];
    return { phone, watch, send, hello, last, view, transport, removeGuest, saved, advance: ms => { now += ms; } };
}

async function ready(game) {
    const f = fixture(game.name);
    const phones = [];
    for (const index of game.seated) phones[index] = f.phone(index);
    if (game.banIndex !== undefined && !game.seated.includes(game.banIndex)) phones[game.banIndex] = f.phone(game.banIndex);
    const watcher = game.privateHands ? f.watch(8) : null;
    for (const socket of phones.filter(Boolean)) await f.hello(socket);
    if (watcher) await f.hello(watcher);
    await f.send(phones[0], 'open', game.open);
    const { id } = f.view(phones[0]);
    for (const index of game.seated.slice(1)) {
        await f.send(phones[index], 'join', { id, seat: 'next' });
    }
    const seats = game.seated.map(index => f.view(phones[index]).seat);
    return { f, phones, watcher, id, seats };
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
        const { f, phones, watcher, id, seats } = await ready(game);
        const stayers = game.seated.filter(index => index !== game.kickIndex && index !== game.banIndex);
        await f.send(phones[game.seated.at(-1)], 'resign', { id, revision: f.view(phones[game.seated.at(-1)]).match?.revision ?? 0 });
        for (const socket of game.seated.map(index => phones[index])) {
            expect(f.last(socket)).toMatchObject({ phase: 'finished', currentMatchId: id });
        }

        const kick = await f.removeGuest(game.kickIndex, 4001, 'kicked');
        const ban = await f.removeGuest(game.banIndex, 4003, 'banned');
        // The fixture closes the session. Revoke does not emit 4001/4003, and a
        // socket that is already closed is outside sockets(), so nothing replaces it.
        expect(kick.socket.readyState).toBe(3);
        expect(ban.socket.readyState).toBe(3);

        for (const socket of [kick.socket, ban.socket]) {
            expect(postCloseFrames(socket, socket === kick.socket ? kick.boundary : ban.boundary)).toEqual([]);
        }
        if (game.privateHands) {
            expect(reportHandLeak(kick.socket, kick.boundary)).toBe(false);
            expect(reportHandLeak(ban.socket, ban.boundary)).toBe(false);
            expect(reportHandLeak(watcher, 0)).toBe(false);
        }

        const stayed = f.saved();
        expect(stayed.id).toBe(id);
        expect(stayed.seats[seats[game.kickIndex]]).toBeNull();
        if (game.seated.includes(game.banIndex)) expect(stayed.seats[seats[game.banIndex]]).toBeNull();
        for (const index of stayers) expect(stayed.seats[seats[index]]).toBe(sidFor(index));

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
        // Chess view() omits occupied. Spades and partner Spades include it.
        if (Object.hasOwn(table, 'occupied')) {
            expect(table.occupied).toEqual(stayers.map(index => seats[index]));
            expect(table.occupied).not.toContain(seats[game.kickIndex]);
            if (game.seated.includes(game.banIndex)) expect(table.occupied).not.toContain(seats[game.banIndex]);
        } else {
            expect(table.seat).toBe(seats[stayers[0]]);
        }
        const dealt = f.saved();
        expect(dealt.match.id).toBe(nextId);
        expect(dealt.seats[seats[game.kickIndex]]).toBeNull();
        if (game.seated.includes(game.banIndex)) expect(dealt.seats[seats[game.banIndex]]).toBeNull();
        for (const index of stayers) expect(dealt.seats[seats[index]]).toBe(sidFor(index));
        await f.send(phones[0], 'sync');
        expect(phones[0].frames.at(-1).t).not.toBe('match-error');
        expect(f.view(phones[0]).id).toBe(nextId);

        for (const socket of [kick.socket, ban.socket]) {
            expect(postCloseFrames(socket, socket === kick.socket ? kick.boundary : ban.boundary)).toEqual([]);
            expect(socket.frames.some(frame => frame.t === 'rematch')).toBe(false);
            // sockets() publishes only while readyState === 1, so the last view stays the finished hand.
            expect(f.view(socket)?.id).toBe(id);
            expect(f.last(socket)).toMatchObject({ phase: 'finished', currentMatchId: id });
            if (game.privateHands) expect(reportHandLeak(socket, socket === kick.socket ? kick.boundary : ban.boundary)).toBe(false);
        }
        if (game.privateHands) {
            expect(f.view(watcher).watchOnly).toBe(true);
            expect(f.view(watcher).seat).toBeNull();
            expect(f.view(watcher).match?.hand ?? []).toEqual([]);
            expect(reportHandLeak(watcher, 0)).toBe(false);
        }
    });
});

describe('Game Night checkpoint restore', () => {
    it('rejects an active TurdJack checkpoint below minSeats', () => {
        const table = new GameNightTurdJack('turdjack-restore-fixture', 'host');
        expect(table.join('guest', table.view('host').id, 0, 'next')).toBe(true);
        expect(table.start('host', table.view('host').id, 0)).toBe(true);

        const checkpoint = structuredClone(table.checkpoint());
        checkpoint.seats.two = null;
        expect(() => GameNightTurdJack.restore(checkpoint)).toThrow(/Invalid active seats/);
    });
});
