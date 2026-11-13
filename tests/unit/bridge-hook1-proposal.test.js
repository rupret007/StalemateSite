// @vitest-environment node
// Tests the BRIDGE-HOOKS.md hook 1 proposal on a copy of the table class
// (tests/unit/bridge-hook1-table.mjs). The real game-night-table.mjs is not edited.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGameNightTable } from './bridge-hook1-table.mjs';

const ID = 'match-0001', HOST = 'host-session-0001', NOW = Date.parse('2026-11-12T21:00:00Z');

class Match {
    constructor(id, players = []) { this.id = id; this.players = players; }
    checkpoint() { return { id: this.id, players: this.players }; }
    static restore(record) { return new Match(record.id, record.players); }
}

const tableClass = (sides, options = {}) => createGameNightTable({
    name: 'test', version: 1, Match, sides, finished: () => true, project: () => ({}),
    create: (id, now, players = []) => new Match(id, players), ...options
});

describe('hook 1 proposal: seat holds on the table', () => {
    it('reserves a real seat name per hold at a four-seat table, never next or the host seat', () => {
        const Table = tableClass(['a', 'b', 'c', 'd'], { manualStart: true, minSeats: 2 });
        const game = new Table(ID, HOST);
        expect(game.holdSeat(ID, HOST, 'grant-hash-1', NOW + 120_000, NOW)).toBe(true);
        expect(game.holdSeat(ID, HOST, 'grant-hash-2', NOW + 120_000, NOW)).toBe(true);
        expect(game.moveHold('grant-hash-1', 'guest-1', NOW + 60_000, NOW)).toBe('b');
        expect(game.moveHold('grant-hash-2', 'guest-2', NOW + 60_000, NOW)).toBe('c');
        // The guest's socket join takes exactly the reserved seat.
        expect(game.join('guest-2', ID, NOW + 1, 'next', 'guest-2')).toBe(true);
        expect(game.seat('guest-2')).toBe('c');
        // A stranger skips the held seat b and gets d; then nothing is left.
        expect(game.join('stranger-1', ID, NOW + 1, 'next')).toBe(true);
        expect(game.seat('stranger-1')).toBe('d');
        expect(game.join('stranger-2', ID, NOW + 1, 'next')).toBe(false);
        expect(game.join('stranger-2', ID, NOW + 1, 'b')).toBe(false);
        expect(game.hasGuestSeat(ID, HOST, NOW + 1)).toBe(false);
        expect(game.hasGuestSeat(ID, HOST, NOW + 1, 'guest-1')).toBe(true);
        expect(game.join('guest-1', ID, NOW + 2, 'next', 'guest-1')).toBe(true);
        expect(game.checkpoint().seats).toEqual({ a: HOST, b: 'guest-1', c: 'guest-2', d: 'stranger-1' });
    });

    it('blocks a stranger at Chess while the hold is live, and frees the seat when it expires', () => {
        const Table = tableClass(['w', 'b']);
        const game = new Table(ID, HOST);
        expect(game.holdSeat(ID, HOST, 'grant-hash-1', NOW + 120_000, NOW)).toBe(true);
        expect(game.hasGuestSeat(ID, HOST)).toBe(false);   // no `now`: holds count as live
        expect(game.join('stranger', ID, NOW + 1, 'next')).toBe(false);
        expect(game.moveHold('grant-hash-1', 'guest-1', NOW + 60_000, NOW)).toBe('b');
        expect(game.join('stranger', ID, NOW + 59_999, 'next')).toBe(false);
        expect(game.expireHolds(NOW + 60_000)).toBe(true);
        expect(game.join('stranger', ID, NOW + 60_000, 'next')).toBe(true);
        expect(game.view(HOST, NOW).waiting).toBe(false);
    });

    it('clears holds when join auto-starts the match, so the checkpoint restores', () => {
        const Table = tableClass(['a', 'b', 'c']);
        const game = new Table(ID, HOST);
        expect(game.join('walk-in', ID, NOW, 'next')).toBe(true);
        expect(game.holdSeat(ID, HOST, 'grant-hash-1', NOW + 120_000, NOW)).toBe(true);
        expect(game.moveHold('grant-hash-1', 'guest-1', NOW + 60_000, NOW)).toBe('c');
        expect(game.join('guest-1', ID, NOW + 1, 'next', 'guest-1')).toBe(true);
        expect(game.checkpoint().holds).toBeUndefined();
        expect(() => Table.restore(game.checkpoint())).not.toThrow();
    });

    it('clears holds on start, so the checkpoint restores; restore still refuses match + holds', () => {
        const Table = tableClass(['a', 'b', 'c', 'd'], { manualStart: true, minSeats: 2 });
        const game = new Table(ID, HOST);
        expect(game.join('guest-1', ID, NOW, 'next')).toBe(true);
        expect(game.holdSeat(ID, HOST, 'grant-hash-2', NOW + 120_000, NOW)).toBe(true);
        expect(game.checkpoint().holds).toEqual([{ holder: 'grant-hash-2', seat: 'c', until: NOW + 120_000 }]);
        expect(Table.restore(game.checkpoint()).checkpoint()).toEqual(game.checkpoint());
        expect(game.start(HOST, ID, NOW + 1)).toBe(true);
        expect(game.checkpoint().holds).toBeUndefined();
        const restored = Table.restore(game.checkpoint());
        expect(restored.view(HOST, NOW).waiting).toBe(false);
        expect(() => Table.restore({ ...game.checkpoint(), holds: [{ holder: 'grant-hash-2', seat: 'c', until: NOW + 120_000 }] }))
            .toThrow('Invalid seat holds');
        // A hold that names the host seat or an occupied seat is refused too.
        const waiting = new Table(ID, HOST).checkpoint();
        expect(() => Table.restore({ ...waiting, holds: [{ holder: 'x-holder', seat: 'a', until: NOW }] })).toThrow('Invalid seat holds');
    });

    it('matches the patch text in BRIDGE-HOOKS.md line for line', () => {
        const doc = readFileSync(new URL('../../BRIDGE-HOOKS.md', import.meta.url), 'utf8');
        const hook1 = doc.slice(doc.indexOf('## Hook 1'), doc.indexOf('## Hook 2'));
        const patch = hook1.slice(hook1.indexOf('```diff'), hook1.indexOf('```', hook1.indexOf('```diff') + 7));
        const added = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1).trim()).filter(Boolean);
        expect(added.length).toBeGreaterThan(40);
        const fixture = readFileSync(new URL('./bridge-hook1-table.mjs', import.meta.url), 'utf8');
        expect(added.filter(line => !fixture.includes(line))).toEqual([]);
        expect(patch).toContain('this.#holds = [];');
        expect(hook1).not.toContain("twoSeats ? sides[1] : 'next'");
    });
});
