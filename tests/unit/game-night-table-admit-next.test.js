// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createGameNightTable } from '../../hangout-worker/src/game-night-table.mjs';
import { GameNightChess } from '../../hangout-worker/src/game-night-chess.mjs';
import { GameNightTurdSpades } from '../../hangout-worker/src/game-night-turdspades.mjs';

const now = 1000;

class StubMatch {
    constructor(id, _now, players = []) {
        this.id = id;
        this.players = players;
        this.finished = false;
    }

    checkpoint() { return { id: this.id, finished: this.finished, players: this.players }; }

    static restore(record) {
        const match = new StubMatch(record.id, 0, record.players ?? []);
        match.finished = record.finished === true;
        return match;
    }

    command() { return { ok: false }; }
    expire() { return false; }
}

const manualFourSeat = createGameNightTable({
    name: 'stub-four',
    version: 1,
    Match: StubMatch,
    sides: ['a', 'b', 'c', 'd'],
    finished: match => match.finished,
    project: () => ({}),
    manualStart: true,
    minSeats: 3,
    create: (id, start, players) => new StubMatch(id, start, players)
});

describe('GameNightTable admit-next after rematch', () => {
    it('seats a queued guest on a four-seat rematch when one seated player is offline', () => {
        const matchId = 'match-four-01';
        const nextId = 'match-four-02';
        const host = 'player-host';
        const seated = { b: 'player-b', c: 'player-c', d: 'player-d' };
        const queued = 'player-queue';
        const table = new GameNightTurdSpades(matchId, host);
        table.join(seated.b, matchId, now, 'west');
        table.join(seated.c, matchId, now, 'north');
        table.join(seated.d, matchId, now, 'east');
        const board = table.view(host, now).match;
        table.command(host, {
            version: board.version, id: board.id, revision: board.revision, action: 'resign'
        }, now);
        expect(table.enqueue(queued)).toBe(true);
        expect(table.view(queued, now)).toMatchObject({ seat: null, upNext: true });

        const connected = new Set([host, seated.b, seated.c, queued]);
        expect(table.requestRematch(host, matchId, nextId, now, { connected })).toBe(true);
        expect(table.requestRematch(seated.b, matchId, nextId, now, { connected })).toBe(true);
        expect(table.requestRematch(seated.c, matchId, nextId, now, { connected })).toBe(true);

        expect(table.view(host, now).id).toBe(nextId);
        expect(table.seat(queued)).toBe('east');
        expect(table.seat(host)).toBe('south');
        expect(table.seat(seated.b)).toBe('west');
        expect(table.seat(seated.c)).toBe('north');
        expect(table.seat(seated.d)).toBeNull();
        expect(table.view(queued, now).upNext).toBeUndefined();
        expect(table.checkpoint().nextGame).toBeUndefined();
    });

    it('seats a queued guest on a two-seat rematch when the away opponent is offline', () => {
        const matchId = 'chess-admit-01';
        const nextId = 'chess-admit-02';
        const white = 'player-white';
        const black = 'player-black';
        const queued = 'player-queue';
        const table = new GameNightChess(matchId, white);
        table.join(black, matchId, now);
        const board = table.view(white, now).match;
        table.command(white, {
            version: 1, id: board.id, revision: board.revision, action: 'resign'
        }, now);
        expect(table.enqueue(queued)).toBe(true);

        const connected = new Set([white, queued]);
        expect(table.requestRematch(white, matchId, nextId, now, { connected })).toBe(true);

        expect(table.view(white, now).id).toBe(nextId);
        expect(table.seat(white)).toBe('w');
        expect(table.seat(queued)).toBe('b');
        expect(table.seat(black)).toBeNull();
        expect(table.view(queued, now)).toMatchObject({ seat: 'b', waiting: false });
    });

    it('keeps every connected seated player during an active hand and does not rematch early', () => {
        const matchId = 'match-hold-01';
        const nextId = 'match-hold-02';
        const host = 'player-host';
        const guest = 'player-guest';
        const queued = 'player-queue';
        const table = new GameNightTurdSpades(matchId, host);
        table.join(guest, matchId, now, 'west');
        table.join('player-n', matchId, now, 'north');
        table.join('player-e', matchId, now, 'east');
        expect(table.enqueue(queued)).toBe(true);
        const seatsBefore = { ...table.checkpoint().seats };
        const board = table.view(host, now).match;

        expect(table.requestRematch(host, matchId, nextId, now, {
            connected: new Set([host, guest, 'player-n', 'player-e', queued])
        })).toBe(false);
        expect(table.checkpoint().seats).toEqual(seatsBefore);
        expect(table.seat(queued)).toBeNull();

        table.command(host, {
            version: board.version, id: board.id, revision: board.revision, action: 'resign'
        }, now);
        const connected = new Set([host, guest, 'player-n', 'player-e', queued]);
        for (const subject of [host, guest, 'player-n', 'player-e']) {
            expect(table.requestRematch(subject, matchId, nextId, now, { connected })).toBe(true);
        }
        expect(table.seat(host)).toBe('south');
        expect(table.seat(guest)).toBe('west');
        expect(table.seat('player-n')).toBe('north');
        expect(table.seat('player-e')).toBe('east');
        expect(table.seat(queued)).toBeNull();
        expect(table.view(queued, now).upNext).toBe(true);
    });

    it('admits a queued guest into an open seat on rematch without moving connected players', () => {
        const matchId = 'match-open-01';
        const nextId = 'match-open-02';
        const host = 'player-host';
        const queued = 'player-queue';
        const table = new manualFourSeat(matchId, host);
        table.join('player-b', matchId, now, 'b');
        table.join('player-c', matchId, now, 'c');
        table.start(host, matchId, now);
        expect(table.enqueue(queued)).toBe(true);

        const checkpoint = table.checkpoint();
        const finished = manualFourSeat.restore({
            ...checkpoint,
            match: { ...checkpoint.match, finished: true }
        });
        const connected = new Set([host, 'player-b', 'player-c', queued]);
        expect(finished.requestRematch(host, matchId, nextId, now, { connected, force: true })).toBe(true);

        expect(finished.seat(queued)).toBe('d');
        expect(finished.seat(host)).toBe('a');
        expect(finished.seat('player-b')).toBe('b');
        expect(finished.seat('player-c')).toBe('c');
        expect(finished.view(queued, now).upNext).toBeUndefined();
    });

    it('releases a stored watch-only seat and admits the queued guest on the same rematch', () => {
        const matchId = 'match-watch-01';
        const nextId = 'match-watch-02';
        const host = 'player-host';
        const west = 'player-west';
        const north = 'player-north';
        const east = 'player-east';
        const queued = 'player-queue';
        const table = new GameNightTurdSpades(matchId, host);
        table.join(west, matchId, now, 'west');
        table.join(north, matchId, now, 'north');
        table.join(east, matchId, now, 'east');
        expect(table.enqueue(queued)).toBe(true);
        // East stays in the connected set, so the offline-yield path cannot take
        // that seat. Only the between-match watch release can free it.
        const watchers = [east];
        const connected = new Set([host, west, north, east, queued]);
        const seatsBefore = { ...table.checkpoint().seats };

        expect(table.requestRematch(host, matchId, nextId, now, { connected, watchers })).toBe(false);
        expect(table.checkpoint().seats).toEqual(seatsBefore);
        expect(table.seat(east)).toBe('east');
        expect(table.seat(queued)).toBeNull();
        expect(table.view(queued, now).upNext).toBe(true);

        const board = table.view(host, now).match;
        table.command(host, {
            version: board.version, id: board.id, revision: board.revision, action: 'resign'
        }, now);
        expect(table.requestRematch(host, matchId, nextId, now, { connected, watchers })).toBe(true);
        expect(table.view(host, now).id).toBe(matchId);
        expect(table.seat(east)).toBe('east');
        expect(table.seat(queued)).toBeNull();

        expect(table.requestRematch(west, matchId, nextId, now, { connected, watchers })).toBe(true);
        expect(table.view(host, now).id).toBe(matchId);
        expect(table.requestRematch(north, matchId, nextId, now, { connected, watchers })).toBe(true);

        expect(table.view(host, now).id).toBe(nextId);
        expect(table.seat(host)).toBe('south');
        expect(table.seat(west)).toBe('west');
        expect(table.seat(north)).toBe('north');
        expect(table.seat(queued)).toBe('east');
        expect(table.seat(east)).toBeNull();
        expect(table.view(queued, now).upNext).toBeUndefined();
        expect(table.view(east, now).upNext).toBeUndefined();
        expect(table.checkpoint().nextGame).toBeUndefined();
        expect(table.checkpoint().seats).toMatchObject({
            south: host, west, north, east: queued
        });

        const watcher = table.view(east, now);
        const dealt = [host, west, north, queued].map(subject => table.view(subject, now).match.hand);
        expect(watcher).toMatchObject({ seat: null, match: { hand: [] } });
        expect(dealt.every(hand => hand.length === 13)).toBe(true);
        const shown = JSON.stringify(watcher);
        for (const hand of dealt) expect(shown).not.toContain(JSON.stringify(hand));
        expect(shown).not.toMatch(/"playable":/);
    });
});
