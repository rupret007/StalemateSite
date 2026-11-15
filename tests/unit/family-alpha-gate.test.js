// @vitest-environment node
// Family-alpha "no dead ends" acceptance checks for the four graded games,
// driven through the real match transport, tables and invitation routes with
// the same in-memory storage shape as arcade-transport.test.js.
import { describe, expect, it, vi } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';
import { DEMO_INVITE_TTL } from '../../hangout-worker/src/beta-auth.mjs';
import { GAME_INVITE_UNAVAILABLE, gameInvitationRequest } from '../../hangout-worker/src/game-night-invitations.mjs';

const room = '#game-2ca9e1x1be34a';
const ref = '0'.repeat(32);
const actorId = index => 'c' + String(index + 1).repeat(32);
const sidFor = index => 'seat-' + index;

function containsPrivateCard(value, card) {
    if (!value || typeof value !== 'object') return false;
    if (!Array.isArray(value) && value.rank === card.rank && value.suit === card.suit) return true;
    return Object.values(value).some(entry => containsPrivateCard(entry, card));
}

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
    // One phone: a lobby binding plus one match socket. A second call with the
    // same index is the same person on a new socket (reload or network return).
    function phone(index) {
        const id = actorId(index), betaSid = sidFor(index);
        if (!actors.has(id)) actors.set(id, { betaSid, betaInviteVersion: 1, canPlay: true, canOpen: index === 0,
            canJoin: subject => subject !== betaSid, canSee: () => true, isPresent: () => true });
        let attachment = { actor: id, betaSid, betaInviteVersion: 1, room, ref, kind: name === 'chess' ? ARCADE_TAG : ARCADE_TAG + ':' + name };
        const socket = { frames: [], readyState: 1, serializeAttachment: data => { attachment = data; },
            deserializeAttachment: () => attachment, send(value) { this.frames.push(JSON.parse(value)); },
            close() { this.readyState = 3; } };
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
    // The phone's socket ends without a leave, as when it loses signal.
    const drop = async socket => { socket.readyState = 3; await transport.presenceChanged(socket.deserializeAttachment()); };
    return { phone, send, hello, last, view, drop, advance: ms => { now += ms; } };
}

async function seated(game) {
    const f = fixture(game.name);
    const phones = Array.from({ length: game.seats }, (_, index) => f.phone(index));
    for (const socket of phones) await f.hello(socket);
    await f.send(phones[0], 'open', game.open);
    const { id } = f.view(phones[0]);
    for (const socket of phones.slice(1)) await f.send(socket, 'join', { id, seat: 'next' });
    const seats = phones.map(socket => f.view(socket).seat);
    return { f, phones, id, seats };
}

const resign = (f, socket) => f.send(socket, 'resign', { id: f.view(socket).id, revision: f.view(socket).match.revision ?? 0 });

describe.each(games)('family alpha: $label has no dead ends', game => {
    it('starts with every phone in its own seat', async () => {
        const { f, phones, seats } = await seated(game);
        expect(new Set(seats).size).toBe(game.seats);
        expect(seats.every(Boolean)).toBe(true);
        for (const socket of phones) expect(f.last(socket)).toMatchObject({ t: 'snapshot', phase: 'playing' });
    });

    it('1. a dropped phone returns to its own seat and the live game, never an empty table', async () => {
        const { f, phones, id, seats } = await seated(game);
        const guest = phones.at(-1), seat = seats.at(-1);
        await f.drop(guest);
        // The others are told who is away and that the seat is still held.
        expect(f.view(phones[0]).disconnectedSeats).toEqual([seat]);
        expect(f.view(phones[0]).match).toBeTruthy();
        const returned = f.phone(game.seats - 1);
        await f.hello(returned);
        const frame = f.last(returned);
        expect(frame).toMatchObject({ t: 'snapshot', phase: 'playing', currentMatchId: id, yourSeat: seat });
        expect(frame.state).toMatchObject({ id, seat, waiting: false });
        expect(frame.state.match).toBeTruthy();
        // A null state with phase "lobby" is what makes the page say "Waiting for the host".
        expect(returned.frames.some(entry => entry.t === 'snapshot' && (entry.state === null || entry.phase === 'lobby'))).toBe(false);
        expect(f.view(phones[0]).disconnectedSeats).toEqual([]);
    });

    it('1b. the host can also drop and return to the first seat', async () => {
        const { f, phones, id, seats } = await seated(game);
        await f.drop(phones[0]);
        const returned = f.phone(0);
        await f.hello(returned);
        expect(f.last(returned)).toMatchObject({ t: 'snapshot', phase: 'playing', currentMatchId: id, yourSeat: seats[0], canOpen: true });
    });

    it('2. one phone too many is refused a seat but keeps a live view of the full table', async () => {
        const { f, id } = await seated(game);
        const extra = f.phone(game.seats);
        await f.hello(extra);
        expect(f.last(extra)).toMatchObject({ t: 'snapshot', phase: 'playing', currentMatchId: id, yourSeat: null });
        expect(f.view(extra)).toMatchObject({ seat: null, waiting: false, hasOpenSeat: false });
        expect(f.view(extra).match).toBeTruthy();
        await f.send(extra, 'join', { id, seat: 'next' });
        expect(extra.frames.at(-1)).toEqual({ t: 'match-error', reason: 'seat-unavailable' });
    });

    it('2b. the extra phone is seated when the next game starts', async () => {
        const { f, phones, id } = await seated(game);
        const extra = f.phone(game.seats);
        await f.hello(extra);
        await resign(f, phones.at(-1));
        await f.send(phones[0], 'start-rematch', { id });
        expect(f.view(extra).seat).toBeTruthy();
    });

    it('2c. after the game ends, a guest who steps away frees the seat for the waiting phone', async () => {
        const { f, phones, id } = await seated(game);
        const extra = f.phone(game.seats);
        await f.hello(extra);
        await resign(f, phones.at(-1));
        await f.send(phones.at(-1), 'leave', { id });
        const open = f.view(extra);
        expect(open).toMatchObject({ seat: null, waiting: true, hasOpenSeat: true });
        await f.send(extra, 'join', { id: open.id, seat: 'next' });
        expect(f.view(extra).seat).toBeTruthy();
    });

    it('4. a finished game gives the host a one-tap rematch that seats everyone again', async () => {
        const { f, phones, id, seats } = await seated(game);
        await resign(f, phones.at(-1));
        for (const socket of phones) expect(f.last(socket)).toMatchObject({ phase: 'finished', currentMatchId: id });
        expect(f.view(phones[0]).canStartRematch).toBe(true);
        for (const socket of phones.slice(1)) expect(f.view(socket).canStartRematch).toBe(false);
        await f.send(phones[0], 'start-rematch', { id });
        const next = f.view(phones[0]).id;
        expect(next).not.toBe(id);
        phones.forEach((socket, index) => {
            expect(socket.frames).toContainEqual({ t: 'rematch', matchId: next });
            expect(f.last(socket)).toMatchObject({ phase: 'playing', currentMatchId: next, yourSeat: seats[index] });
            expect(f.view(socket).match.result ?? null).toBeNull();
        });
    });

    it('4b. a rematch also starts once every connected player has asked, even with one phone away', async () => {
        const { f, phones, id, seats } = await seated(game);
        await resign(f, phones.at(-1));
        await f.send(phones.at(-1), 'rematch', { id });
        expect(f.view(phones[0]).id).toBe(id);
        if (game.seats > 2) await f.drop(phones[1]);
        for (const socket of phones.slice(0, -1).filter(entry => entry.readyState === 1)) await f.send(socket, 'rematch', { id });
        const next = f.view(phones[0]).id;
        expect(next).not.toBe(id);
        expect(f.last(phones.at(-1))).toMatchObject({ phase: 'playing', currentMatchId: next, yourSeat: seats.at(-1) });
        if (game.seats > 2) {
            const returned = f.phone(1);
            await f.hello(returned);
            expect(f.last(returned)).toMatchObject({ phase: 'playing', currentMatchId: next, yourSeat: seats[1] });
        }
    });

    it('5. a late joiner can watch and is never sent a hand', async () => {
        const { f, phones, id } = await seated(game);
        const watcher = f.phone(game.seats);
        await f.hello(watcher);
        expect(f.last(watcher)).toMatchObject({ t: 'snapshot', phase: 'playing', currentMatchId: id, yourSeat: null });
        const watched = f.view(watcher).match;
        expect(watched).toBeTruthy();
        if (game.privateHands) {
            const hands = phones.map(socket => f.view(socket).match.hand);
            for (const hand of hands) expect(hand).toHaveLength(13);
            const privateCards = hands.flat();
            const assertNoPrivateCards = payload => {
                for (const card of privateCards) expect(containsPrivateCard(payload, card)).toBe(false);
            };
            // Check all historical frames and the current view by card identity,
            // independent of the property that carries a card or hand.
            assertNoPrivateCards(watcher.frames);
            assertNoPrivateCards(f.view(watcher));
        }
        // Watching keeps up with play, and a watcher cannot act on the table.
        const before = watcher.frames.length;
        await resign(f, watcher);
        expect(watcher.frames.slice(before).some(frame => frame.t === 'match-error')).toBe(true);
        expect(f.view(phones[0]).match.result ?? null).toBeNull();
        await resign(f, phones.at(-1));
        expect(f.last(watcher)).toMatchObject({ phase: 'finished', yourSeat: null });
        if (game.privateHands) expect(f.view(watcher).match.hand).toEqual([]);
        if (game.privateHands) {
            // A phone waiting for the next table can be seated by rematch.
            // A distinct late watcher and its reconnect remain unseated.
            await f.send(phones[0], 'start-rematch', { id });
            const returnedWatcher = f.phone(game.seats + 1);
            await f.hello(returnedWatcher);
            expect(f.last(returnedWatcher)).toMatchObject({ phase: 'playing', yourSeat: null });
            expect(f.view(returnedWatcher)).toMatchObject({ seat: null, match: { hand: [] } });
            expect(f.last(phones[0]).yourSeat).toBeTruthy();
            const rematchCards = phones.map(socket => f.view(socket).match.hand).flat();
            const assertNoRematchCards = payload => {
                for (const card of rematchCards) expect(containsPrivateCard(payload, card)).toBe(false);
            };
            assertNoRematchCards(returnedWatcher.frames);
            assertNoRematchCards(f.view(returnedWatcher));
            await f.drop(returnedWatcher);
            const reconnectedWatcher = f.phone(game.seats + 1);
            await f.hello(reconnectedWatcher);
            expect(f.last(reconnectedWatcher)).toMatchObject({ phase: 'playing', yourSeat: null });
            expect(f.view(reconnectedWatcher)).toMatchObject({ seat: null, match: { hand: [] } });
            assertNoRematchCards(reconnectedWatcher.frames);
            assertNoRematchCards(f.view(reconnectedWatcher));
        }
    });
});

describe('family alpha: an expired invite', () => {
    function invitations() {
        const host = 'host-session-aaaa', rows = new Map();
        const lobby = {
            env: { HANGOUT_BETA_MODE: 'protected', HANGOUT_GAME_NIGHT_GUESTS: '1' },
            state: { storage: {
                get: async key => rows.get(key), list: async () => rows,
                put: async (key, record) => rows.set(key, record), delete: async keys => { for (const key of [keys].flat()) rows.delete(key); }
            } },
            controlBudget: { take: async () => true },
            arcadeAvailable: () => true,
            arcadeBinding: () => ({ betaSid: host, betaInviteVersion: '1', canOpen: true, canPlay: true, nick: 'HostExample' }),
            sessionActive: async () => true,
            engine: { invitedGameHost: () => 'c' + 'a'.repeat(32) },
            arcade: { get: () => ({
                hasGuestSeat: async () => true,
                guestTableId: async (_scope, match) => match,
                guestNightEndsAt: async () => Date.now() + DEMO_INVITE_TTL,
                reserveGuestSeat: async (_scope, _sid, _until, key, record) => { rows.set(key, record); return true; }
            }) }
        };
        const issue = async game => (await gameInvitationRequest(lobby, 'issue', {
            actor: 'c' + 'a'.repeat(32), room: '#game-1acbefx23acbe', ref: 'c'.repeat(32), game, match: '11111111-1111-4111-8111-111111111111'
        }, { betaSid: host })).json();
        return { lobby, issue };
    }

    it.each(['chess', 'turdspades', 'turdanoid'])('3. closes the old %s link with the ask-for-a-new-one answer and the host can issue a fresh one', async game => {
        vi.useFakeTimers();
        try {
            const now = Date.now();
            const { lobby, issue } = invitations();
            const first = await issue(game);
            expect(first.until - now).toBe(DEMO_INVITE_TTL);
            expect((await gameInvitationRequest(lobby, 'details', { code: first.code })).status).toBe(200);
            vi.setSystemTime(first.until);
            for (const [operation, body] of [['details', {}], ['accept', { age13: true, attempt: 'e'.repeat(32) }]]) {
                const closed = await gameInvitationRequest(lobby, operation, { code: first.code, ...body });
                expect(closed.status).toBe(410);
                expect(await closed.json()).toEqual({ error: GAME_INVITE_UNAVAILABLE });
            }
            expect(GAME_INVITE_UNAVAILABLE).toMatch(/ask your host for a new one/i);
            // The way forward exists only on the host's phone: a new link for the same table.
            const fresh = await issue(game);
            expect(fresh.code).not.toBe(first.code);
            expect((await gameInvitationRequest(lobby, 'details', { code: fresh.code })).status).toBe(200);
            const accepted = await gameInvitationRequest(lobby, 'accept', { code: fresh.code, age13: true, attempt: 'e'.repeat(32) });
            expect(accepted.status).toBe(200);
        } finally { vi.useRealTimers(); }
    });
});
