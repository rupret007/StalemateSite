// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createGameNightTable } from '../../hangout-worker/src/game-night-table.mjs';
import { GameNightChess } from '../../hangout-worker/src/game-night-chess.mjs';
import { GameNightTurdSpades } from '../../hangout-worker/src/game-night-turdspades.mjs';

const now = 1000;

function finish(table, subject, nowAt = now) {
    const board = table.view(subject, nowAt).match;
    expect(board).toBeTruthy();
    const result = table.command(subject, {
        version: board.version, id: board.id, revision: board.revision, action: 'resign'
    }, nowAt);
    expect(result.ok).toBe(true);
}

function completeRematch(table, id, nextId, voters, connected) {
    for (const subject of voters) {
        expect(table.requestRematch(subject, id, nextId, now, { connected })).toBe(true);
    }
    expect(table.view(voters[0], now).id).toBe(nextId);
}

describe('GameNightTable rematch admission keeps offline seats', () => {
    it('keeps an offline chess seat and leaves the queued guest waiting', () => {
        const id = 'chess-admit-01';
        const nextId = 'chess-admit-02';
        const white = 'player-white';
        const black = 'player-black';
        const queued = 'player-queued';
        const table = new GameNightChess(id, white);
        expect(table.join(black, id, now)).toBe(true);
        finish(table, white);
        expect(table.enqueue(queued)).toBe(true);

        completeRematch(table, id, nextId, [white], new Set([white, queued]));
        expect(table.seat(black)).toBe('b');
        expect(table.seat(queued)).toBeNull();
        expect(table.view(queued, now)).toMatchObject({ seat: null, upNext: true });

        // The returning phone uses the same subject/pass and recovers its seat.
        expect(table.view(black, now)).toMatchObject({ seat: 'b' });
    });

    it('keeps an offline Turd Spades seat and leaves the queued guest waiting', () => {
        const id = 'spades-admit-01';
        const nextId = 'spades-admit-02';
        const host = 'player-host';
        const west = 'player-west';
        const north = 'player-north';
        const east = 'player-east';
        const queued = 'player-queued';
        const table = new GameNightTurdSpades(id, host);
        expect(table.join(west, id, now, 'west')).toBe(true);
        expect(table.join(north, id, now, 'north')).toBe(true);
        expect(table.join(east, id, now, 'east')).toBe(true);
        finish(table, host);
        expect(table.enqueue(queued)).toBe(true);

        const connected = new Set([host, west, north, queued]);
        completeRematch(table, id, nextId, [host, west, north], connected);
        expect(table.seat(east)).toBe('east');
        expect(table.seat(queued)).toBeNull();
        expect(table.view(queued, now)).toMatchObject({ seat: null, upNext: true });
        expect(table.view(east, now)).toMatchObject({ seat: 'east' });
    });

    it('admits the line after a guest explicitly leaves between matches', () => {
        const id = 'leave-admit-01';
        const nextId = 'leave-admit-02';
        const reopenedId = 'leave-admit-03';
        const host = 'player-host';
        const guest = 'player-guest';
        const queued = 'player-queued';
        const table = new GameNightTurdSpades(id, host);
        expect(table.join(guest, id, now, 'west')).toBe(true);
        expect(table.join('player-north', id, now, 'north')).toBe(true);
        expect(table.join('player-east', id, now, 'east')).toBe(true);
        finish(table, host);
        expect(table.enqueue(queued)).toBe(true);
        expect(table.vacate(guest, nextId)).toBe(true);
        expect(table.close(host, nextId)).toBe(true);
        expect(table.reopen(host, reopenedId, undefined, now, new Set([host, 'player-north', 'player-east', queued]))).toBe(true);
        expect(table.seat(queued)).toBe('west');
        expect(table.view(queued, now).upNext).toBeUndefined();
    });

    it('does not let a dequeued watch-only or invalid queue entry block a real guest', () => {
        const id = 'watch-admit-01';
        const nextId = 'watch-admit-02';
        const reopenedId = 'watch-admit-03';
        const host = 'player-host';
        const guest = 'player-guest';
        const watchOnly = 'watch-only';
        const queued = 'player-queued';
        const table = new GameNightTurdSpades(id, host);
        expect(table.join(guest, id, now, 'west')).toBe(true);
        expect(table.join('player-north', id, now, 'north')).toBe(true);
        expect(table.join('player-east', id, now, 'east')).toBe(true);
        finish(table, host);
        expect(table.enqueue(watchOnly)).toBe(true);
        expect(table.dequeue(watchOnly)).toBe(true);
        expect(table.enqueue(queued)).toBe(true);
        expect(table.vacate(guest, nextId)).toBe(true);
        expect(table.close(host, nextId)).toBe(true);
        expect(table.reopen(host, reopenedId, undefined, now, new Set([host, 'player-north', 'player-east', queued]))).toBe(true);
        expect(table.seat(queued)).toBe('west');
        expect(table.seat(watchOnly)).toBeNull();
    });
});
