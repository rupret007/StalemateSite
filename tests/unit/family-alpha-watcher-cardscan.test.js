// @vitest-environment node
// Card-id privacy regression for an explicitly watch-only Spades guest.
import { describe, expect, it } from 'vitest';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';

const room = '#game-2ca9e1x1be34a';
const ref = '0'.repeat(32);
const actorId = index => 'c' + String(index + 1).repeat(32);
const sidFor = index => 'seat-' + index;

function fixture() {
    const records = new Map(), actors = new Map(), connections = [];
    let now = 1000, matchCount = 0;
    const storage = {
        getAlarm: async () => null,
        setAlarm: async () => {},
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
            deserializeAttachment: () => attachment, send(value) { this.frames.push(JSON.parse(value)); },
            close() { this.readyState = 3; } };
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
    return { phone, send, hello, last, view, binding: index => actors.get(actorId(index)) };
}

describe('family alpha: Spades watcher card-id privacy', () => {
    it('keeps every watcher frame free of private card ids through hello, a trick, rematch and reopen', async () => {
        const f = fixture();
        const players = Array.from({ length: 4 }, (_, index) => f.phone(index));
        for (const socket of players) await f.hello(socket);
        await f.send(players[0], 'open');
        const { id, tableId } = f.view(players[0]);
        for (const socket of players.slice(1)) await f.send(socket, 'join', { id, seat: 'next' });

        const watcherIndex = 4;
        const watcher = f.phone(watcherIndex);
        f.binding(watcherIndex).gameGuest = { room, ref, host: sidFor(0), match: id, tableId, game: 'turdspades', watch: true };

        const scanWatcherFrames = () => {
            const privateCards = players.flatMap(socket => f.view(socket)?.match?.hand ?? []);
            const visibleCardIds = [];
            const collectCards = value => {
                if (Array.isArray(value)) return value.forEach(collectCards);
                if (!value || typeof value !== 'object') return;
                if (Number.isInteger(value.id) && value.rank && value.suit) visibleCardIds.push(value.id);
                Object.values(value).forEach(collectCards);
            };
            for (const frame of watcher.frames) {
                collectCards(frame);
                const state = frame.state;
                if (!state?.match) continue;
                expect(state.match).not.toHaveProperty('hands');
                expect(state.match.hand ?? []).toEqual([]);
            }
            // Publicly played cards leave a player's hand; every still-private id must be absent.
            for (const card of privateCards) expect(visibleCardIds).not.toContain(card.id);
        };

        await f.hello(watcher);
        expect(f.last(watcher)).toMatchObject({ t: 'snapshot', phase: 'playing', currentMatchId: id, yourSeat: null });
        scanWatcherFrames();

        // Drive the table until one trick completes, using only the current player's legal hand.
        let turns = 0;
        while ((f.view(players[0]).match.tricks?.south ?? 0) + (f.view(players[0]).match.tricks?.west ?? 0) +
            (f.view(players[0]).match.tricks?.north ?? 0) + (f.view(players[0]).match.tricks?.east ?? 0) < 1 && turns++ < 20) {
            const state = f.view(players[0]).match;
            const seat = state.turn;
            const current = players.find(socket => f.view(socket).seat === seat);
            expect(current).toBeTruthy();
            const own = f.view(current).match;
            const action = own.phase === 'bid' ? { action: 'bid', bid: 1 }
                : { action: 'play', card: own.hand.find(card => card.playable).id };
            await f.send(current, action.action, { id: own.id, revision: own.revision ?? 0, ...action });
            scanWatcherFrames();
        }
        expect(turns).toBeLessThan(20);

        await f.send(players[0], 'resign', { id, revision: f.view(players[0]).match.revision ?? 0 });
        await f.send(players[0], 'start-rematch', { id });
        let next = f.view(players[0]).id;
        expect(next).not.toBe(id);
        scanWatcherFrames();

        // Finish the rematch, close the table, and have the host reopen it.
        await f.send(players[0], 'resign', { id: next, revision: f.view(players[0]).match.revision ?? 0 });
        await f.send(players[0], 'leave', { id: next });
        await f.send(players[0], 'open');
        next = f.view(players[0]).id;
        await f.send(watcher, 'sync');
        expect(f.view(watcher)).toMatchObject({ watchOnly: true, seat: null, match: { hand: [], phase: 'bid' } });
        expect(f.view(watcher).match).not.toHaveProperty('hands');
        scanWatcherFrames();
    });
});
