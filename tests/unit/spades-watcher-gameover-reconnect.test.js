// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';

const room = '#spades-watcher-fixture';
const ref = '0'.repeat(32);
const actorId = index => 'c' + String(index + 1).repeat(32);
const sidFor = index => 'seat-' + index;

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
        now: () => now, uuid: () => 'c8eb7f10-e113-418f-9900-' + String(++matchCount).padStart(12, '0'),
        current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
        charge: async () => true, allowed: () => true });
    const send = (socket, action, fields = {}) => transport.receive(socket, JSON.stringify({ version: 1, action, ...fields }));
    const hello = socket => transport.receive(socket, JSON.stringify({ version: 1, t: 'hello', lastSeq: 0 }));
    const last = socket => socket.frames.findLast(frame => frame.t === 'match-state' || frame.t === 'snapshot');
    const view = socket => last(socket)?.state;
    const drop = async socket => { socket.readyState = 3; await transport.presenceChanged(socket.deserializeAttachment()); };
    return { phone, send, hello, last, view, drop };
}

async function seated(f, count, open = {}) {
    const players = Array.from({ length: count }, (_, index) => f.phone(index));
    for (const socket of players) await f.hello(socket);
    await f.send(players[0], 'open', open);
    const id = f.view(players[0]).id;
    for (const socket of players.slice(1)) await f.send(socket, 'join', { id, seat: 'next' });
    return { players, id };
}

const matchFor = (f, socket) => f.view(socket).match;
const bid = (f, socket, amount = 2) => f.send(socket, 'bid', { id: f.view(socket).id, revision: matchFor(f, socket).revision, bid: amount });
const play = (f, socket) => f.send(socket, 'play', { id: f.view(socket).id, revision: matchFor(f, socket).revision, card: matchFor(f, socket).hand.find(card => card.playable).id });

describe('Spades watcher privacy across game over and reconnect', () => {
    it('shows a partners watcher the completed bids and score without a hand', async () => {
        const f = fixture('turdspades');
        const { players, id } = await seated(f, 2, { mode: 'partners' });
        const watcher = f.phone(2);
        await f.hello(watcher);
        expect(f.view(watcher).seat).toBeNull();
        // CPU partners bid automatically; finish the auction in the match's turn order.
        while (matchFor(f, players[0]).phase === 'bid') {
            const turn = matchFor(f, players[0]).turn;
            const actor = players.find(socket => f.view(socket).seat === turn);
            expect(actor).toBeTruthy();
            await bid(f, actor);
        }
        await f.send(players[0], 'resign', { id, revision: matchFor(f, players[0]).revision });
        const watched = f.view(watcher);
        expect(f.last(watcher)).toMatchObject({ phase: 'finished', currentMatchId: id, yourSeat: null });
        expect(watched.seat).toBeNull();
        expect(watched.match).toMatchObject({ result: expect.any(Object), bids: expect.any(Object), scores: expect.any(Array), hand: [] });
        expect(Object.values(watched.match.bids).every(value => value !== null)).toBe(true);
    });

    it('keeps a four-player watcher unseated and handless after dropping and reconnecting mid-hand', async () => {
        const f = fixture('turdspades');
        const { players, id } = await seated(f, 4);
        const watcher = f.phone(4);
        await f.hello(watcher);
        expect(f.view(watcher).seat).toBeNull();
        while (matchFor(f, players[0]).phase === 'bid') {
            const turn = matchFor(f, players[0]).turn;
            const actor = players.find(socket => f.view(socket).seat === turn);
            expect(actor).toBeTruthy();
            await bid(f, actor);
        }
        const turnSubject = f.view(players[0]).match.turn;
        const actor = players.find(socket => f.view(socket).seat === turnSubject);
        await play(f, actor);
        expect(f.view(watcher).match.phase).toBe('play');
        await f.drop(watcher);
        const returned = f.phone(4);
        await f.hello(returned);
        const state = f.view(returned);
        expect(f.last(returned)).toMatchObject({ t: 'snapshot', phase: 'playing', currentMatchId: id, yourSeat: null });
        expect(state.seat).toBeNull();
        expect(state.match.hand ?? []).toEqual([]);
    });
});
