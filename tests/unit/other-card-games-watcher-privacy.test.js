// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';
import { CrapeightsMatch } from '../../hangout-worker/arcade/games/crapeights-match.js';
import { TurdRummyMatch } from '../../hangout-worker/arcade/games/turdrummy-match.js';
import { RANKS, SUITS } from '../../hangout-worker/arcade/games/cards.js';
import { TurdJackMatch, TURDJACK_MATCH_VERSION } from '../../hangout-worker/arcade/games/turdjack-match.js';

const matchId = 'privacy-match-001';

function privateHandCardIds(checkpoint) {
    return [...checkpoint.hands.a, ...checkpoint.hands.b];
}

function assertNoPrivateHandsInSerialized(serialized, seatedHands) {
    for (const hand of seatedHands) {
        expect(serialized).not.toContain(JSON.stringify(hand));
    }
    expect(serialized).not.toMatch(/"playable":/);
    expect(serialized).not.toMatch(/"hands":\s*\[/);
    expect(serialized).not.toMatch(/"hand":\s*\[\s*\{/);
}

function transportFixture(name) {
    const records = new Map(), actors = new Map(), connections = [];
    let now = 1000, matchCount = 0, alarm = null;
    const storage = {
        getAlarm: async () => alarm,
        setAlarm: async at => { alarm = at; },
        get: async key => structuredClone(records.get(key)),
        put: async (key, value) => {
            for (const [entry, record] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) {
                records.set(entry, structuredClone(record));
            }
        },
        delete: async key => { for (const entry of [key].flat()) records.delete(entry); },
        list: async ({ prefix = '' } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix)))
    };
    const actorId = index => 'c' + String(index + 1).repeat(32);
    const sidFor = index => 'seat-' + index;
    function phone(index, canOpen = index === 0) {
        const id = actorId(index), betaSid = sidFor(index);
        if (!actors.has(id)) {
            actors.set(id, { betaSid, betaInviteVersion: 1, canPlay: true, canOpen,
                canJoin: subject => subject !== betaSid, canSee: () => true, isPresent: () => true });
        }
        let attachment = { actor: id, betaSid, betaInviteVersion: 1, room: '#game-privacy', ref: '0'.repeat(32),
            kind: ARCADE_TAG + ':' + name };
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
    const view = socket => socket.frames.findLast(frame => frame.t === 'match-state' || frame.t === 'snapshot')?.state;
    return { phone, send, hello, view, transport, actors, sidFor };
}

describe('crapeights watcher privacy', () => {
    it('view(null) hides every seated hand and keeps discard, counts, and turn', () => {
        const match = new CrapeightsMatch(matchId);
        const checkpoint = match.checkpoint();
        const seated = { a: match.view('a'), b: match.view('b') };
        const watch = match.view(null);

        expect(seated.a.hand).toHaveLength(7);
        expect(seated.b.hand).toHaveLength(7);
        expect(watch.hand).toEqual([]);
        expect(watch.top).toEqual(seated.a.top);
        expect(watch.counts).toEqual(seated.a.counts);
        expect(watch.turn).toBe(seated.a.turn);
        expect(watch.deckCount).toBe(checkpoint.deck.length);
        expect(Object.keys(watch)).not.toContain('deck');
        expect(Object.keys(watch)).not.toContain('hands');

        const serialized = JSON.stringify(watch);
        assertNoPrivateHandsInSerialized(serialized, [seated.a.hand, seated.b.hand]);
        for (const id of privateHandCardIds(checkpoint)) {
            expect(serialized).not.toMatch(new RegExp(`"id":${id}[,\\}]`));
        }
    });

    it('projects the same match through watch-only transport sync', async () => {
        const f = transportFixture('crapeights');
        const host = f.phone(0), guest = f.phone(1), watcher = f.phone(2);
        await f.hello(host);
        await f.hello(guest);
        await f.send(host, 'open');
        const { id } = f.view(guest);
        await f.send(guest, 'join', { id, seat: 'next' });
        await f.hello(watcher);

        f.actors.get('c' + '3'.repeat(32)).gameGuest = {
            room: '#game-privacy', ref: '0'.repeat(32), host: f.sidFor(0), match: id, tableId: id,
            game: 'crapeights', watch: true
        };
        await f.hello(watcher);

        const transportWatch = f.view(watcher).match;
        expect(transportWatch.hand).toEqual([]);
        expect(transportWatch.top).toEqual(f.view(host).match.top);
        expect(transportWatch.counts).toEqual(f.view(host).match.counts);
        expect(transportWatch.turn).toBe(f.view(host).match.turn);
        assertNoPrivateHandsInSerialized(JSON.stringify(watcher.frames), [f.view(host).match.hand, f.view(guest).match.hand]);
        expect(f.view(watcher).seat).toBeNull();
        expect(watcher.frames.at(-1)).toMatchObject({ yourSeat: null });
    });
});

describe('turdrummy watcher privacy', () => {
    it('view(null) hides every seated hand and keeps top, stock count, and turn', () => {
        const match = new TurdRummyMatch(matchId);
        const checkpoint = match.checkpoint();
        const seated = { a: match.view('a'), b: match.view('b') };
        const watch = match.view(null);

        expect(seated.a.hand).toHaveLength(10);
        expect(seated.b.hand).toHaveLength(10);
        expect(watch.hand).toEqual([]);
        expect(watch.drawn).toBeNull();
        expect(watch.top).toEqual(seated.a.top);
        expect(watch.counts).toEqual(seated.a.counts);
        expect(watch.turn).toBe(seated.a.turn);
        expect(watch.stockCount).toBe(checkpoint.stock.length);
        expect(Object.keys(watch)).not.toContain('stock');
        expect(Object.keys(watch)).not.toContain('hands');

        const serialized = JSON.stringify(watch);
        assertNoPrivateHandsInSerialized(serialized, [seated.a.hand, seated.b.hand]);
        for (const id of privateHandCardIds(checkpoint)) {
            expect(serialized).not.toMatch(new RegExp(`"id":${id}[,\\}]`));
        }
    });

    it('projects the same match through watch-only transport sync', async () => {
        const f = transportFixture('turdrummy');
        const host = f.phone(0), guest = f.phone(1), watcher = f.phone(2);
        await f.hello(host);
        await f.hello(guest);
        await f.send(host, 'open');
        const { id } = f.view(guest);
        await f.send(guest, 'join', { id, seat: 'next' });
        f.actors.get('c' + '3'.repeat(32)).gameGuest = {
            room: '#game-privacy', ref: '0'.repeat(32), host: f.sidFor(0), match: id, tableId: id,
            game: 'turdrummy', watch: true
        };
        await f.hello(watcher);

        const transportWatch = f.view(watcher).match;
        expect(transportWatch.hand).toEqual([]);
        expect(transportWatch.top).toEqual(f.view(host).match.top);
        expect(transportWatch.stockCount).toBe(f.view(host).match.stockCount);
        assertNoPrivateHandsInSerialized(JSON.stringify(watcher.frames), [f.view(host).match.hand, f.view(guest).match.hand]);
        expect(f.view(watcher).seat).toBeNull();
    });
});

describe('turdjack watcher privacy', () => {
    const jackSeats = ['one', 'two'];

    function jackCardId(rank, suitIndex = 0) {
        const index = RANKS.indexOf(rank);
        if (index < 0) { throw new TypeError(`unknown rank: ${rank}`); }
        return suitIndex * 13 + index;
    }

    /** First id in dealOrder is the first card popped from the shoe (two-player initial deal). */
    function turdJackWithStackedDeal(dealOrder) {
        const match = new TurdJackMatch(matchId, jackSeats);
        const checkpoint = match.checkpoint();
        const forced = new Set(dealOrder);
        const shoe = checkpoint.shoe.filter(id => !forced.has(id));
        for (let i = dealOrder.length - 1; i >= 0; i--) { shoe.push(dealOrder[i]); }
        checkpoint.shoe = shoe;
        return TurdJackMatch.restore(checkpoint);
    }

    function dealTwoPlayerJack(match) {
        const id = match.checkpoint().id;
        let revision = 0;
        expect(match.command('one', { version: TURDJACK_MATCH_VERSION, id, revision, action: 'wager', chips: 10 })).toEqual({ ok: true });
        revision++;
        expect(match.command('two', { version: TURDJACK_MATCH_VERSION, id, revision, action: 'wager', chips: 10 })).toEqual({ ok: true });
        const state = match.checkpoint();
        if (state.phase === 'insurance') {
            revision = state.revision;
            expect(match.command('one', { version: TURDJACK_MATCH_VERSION, id, revision, action: 'skip-cover' })).toEqual({ ok: true });
            revision++;
            expect(match.command('two', { version: TURDJACK_MATCH_VERSION, id, revision, action: 'skip-cover' })).toEqual({ ok: true });
        }
        return match;
    }

    function assertWatcherHidesSeatedHands(watch, seated) {
        const serialized = JSON.stringify(watch);
        for (const seat of jackSeats) {
            for (const hand of seated[seat].self.hands) {
                expect(serialized).not.toContain(JSON.stringify(hand.cards));
            }
        }
        expect(serialized).not.toMatch(/"cards":\s*\[/);
    }

    it('view(null) hides player cards and the dealer hole card while play is in progress', () => {
        const dealOrder = [
            jackCardId('2'), jackCardId('2', 1), jackCardId('5'),
            jackCardId('3'), jackCardId('3', 1), jackCardId('7')
        ];
        const match = dealTwoPlayerJack(turdJackWithStackedDeal(dealOrder));
        const seated = { one: match.view('one'), two: match.view('two') };
        const watch = match.view(null);

        expect(match.checkpoint().phase).toBe('play');
        expect(seated.one.self.hands[0].cards).toHaveLength(2);
        expect(seated.two.self.hands[0].cards).toHaveLength(2);
        expect(watch.self).toBeNull();
        expect(watch.phase).toBe(seated.one.phase);
        expect(watch.active).toBe(seated.one.active);
        expect(watch.players).toEqual(jackSeats);
        expect(watch.table).toEqual(seated.one.table);
        expect(watch.dealerHidden).toBe(true);
        expect(watch.dealer).toHaveLength(1);
        const upcardId = dealOrder[2];
        expect(watch.dealer[0]).toEqual({
            rank: RANKS[upcardId % 13],
            suit: SUITS[Math.floor(upcardId / 13) % 4]
        });
        expect(Object.keys(watch)).not.toContain('shoe');
        expect(watch.actions).toEqual([]);

        assertWatcherHidesSeatedHands(watch, seated);
    });

    it('view(null) shows the same public dealer reveal as seated players after settlement', () => {
        const dealOrder = [
            jackCardId('2'), jackCardId('2', 1), jackCardId('K'),
            jackCardId('3'), jackCardId('3', 1), jackCardId('A')
        ];
        const match = dealTwoPlayerJack(turdJackWithStackedDeal(dealOrder));
        const seated = { one: match.view('one'), two: match.view('two') };
        const watch = match.view(null);

        expect(match.checkpoint().phase).toBe('settled');
        expect(watch.self).toBeNull();
        expect(watch.phase).toBe('settled');
        expect(watch.dealerHidden).toBe(false);
        expect(watch.dealer).toHaveLength(2);
        expect(watch.dealer).toEqual(seated.one.dealer);
        expect(watch.dealer).toEqual(seated.two.dealer);
        expect(watch.dealerTotal).toBe(seated.one.dealerTotal);
        expect(Object.keys(watch)).not.toContain('shoe');
        expect(watch.actions).toEqual([]);

        assertWatcherHidesSeatedHands(watch, seated);
    });

    it('view(null) reveals dealer after ace-up natural once insurance is declined', () => {
        const dealOrder = [
            jackCardId('2'), jackCardId('2', 1), jackCardId('A'),
            jackCardId('3'), jackCardId('3', 1), jackCardId('K')
        ];
        const match = dealTwoPlayerJack(turdJackWithStackedDeal(dealOrder));
        const seated = { one: match.view('one'), two: match.view('two') };
        const watch = match.view(null);

        expect(match.checkpoint().phase).toBe('settled');
        expect(watch.dealerHidden).toBe(false);
        expect(watch.dealer).toHaveLength(2);
        expect(watch.dealer).toEqual(seated.one.dealer);
        assertWatcherHidesSeatedHands(watch, seated);
    });

    it('projects the same match through watch-only transport sync', async () => {
        const f = transportFixture('turdjack');
        const host = f.phone(0), guest = f.phone(1), watcher = f.phone(2);
        await f.hello(host);
        await f.hello(guest);
        await f.send(host, 'open');
        const { id } = f.view(host);
        await f.send(guest, 'join', { id, seat: 'next' });
        await f.send(host, 'start', { id });
        let publicMatch = f.view(host).match;
        expect(publicMatch).toBeTruthy();
        await f.send(host, 'wager', { id, revision: publicMatch.revision, chips: 10 });
        publicMatch = f.view(host).match;
        await f.send(guest, 'wager', { id, revision: publicMatch.revision, chips: 10 });
        publicMatch = f.view(host).match;
        if (publicMatch.phase === 'insurance') {
            await f.send(host, 'skip-cover', { id, revision: publicMatch.revision });
            publicMatch = f.view(host).match;
            await f.send(guest, 'skip-cover', { id, revision: publicMatch.revision });
            publicMatch = f.view(host).match;
        }
        f.actors.get('c' + '3'.repeat(32)).gameGuest = {
            room: '#game-privacy', ref: '0'.repeat(32), host: f.sidFor(0), match: id, tableId: id,
            game: 'turdjack', watch: true
        };
        await f.hello(watcher);

        const transportWatch = f.view(watcher).match;
        expect(transportWatch.self).toBeNull();
        expect(transportWatch.table).toEqual(publicMatch.table);
        expect(transportWatch.dealer).toEqual(publicMatch.dealer);
        const seatedHands = [f.view(host).match.self, f.view(guest).match.self];
        const sent = JSON.stringify(watcher.frames);
        for (const self of seatedHands) {
            for (const hand of self.hands) {
                expect(sent).not.toContain(JSON.stringify(hand.cards));
            }
        }
        expect(f.view(watcher).seat).toBeNull();
    });
});