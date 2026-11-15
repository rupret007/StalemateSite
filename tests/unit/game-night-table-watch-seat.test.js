// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GameNightChess } from '../../hangout-worker/src/game-night-chess.mjs';

const now = 1000;
const host = 'member-one';
const watcher = 'member-two';

function legacyTable() {
    const table = new GameNightChess('watch-one', host);
    table.join(watcher, 'watch-one', now);
    table.command(host, { version: 1, id: 'watch-one', revision: 0, action: 'resign' }, now);
    return table;
}

describe('Game Night watch-only seat cleanup', () => {
    it('releases a legacy watcher seat before starting a rematch', () => {
        const table = legacyTable();

        expect(table.seat(watcher)).toBe('b');
        expect(table.dequeue(watcher)).toBe(true);
        expect(table.requestRematch(host, 'watch-one', 'watch-two', now, { force: true })).toBe(true);

        expect(table.subjects).toEqual([host]);
        expect(table.seat(watcher)).toBeNull();
        expect(table.view(watcher, now).seat).toBeNull();
    });

    it('releases a legacy watcher seat before reopening a closed table', () => {
        const table = legacyTable();

        expect(table.close(host, 'watch-one')).toBe(true);
        expect(table.dequeue(watcher)).toBe(true);
        expect(table.reopen(host, 'watch-two', undefined, now, new Set([host, watcher]))).toBe(true);

        expect(table.subjects).toEqual([host]);
        expect(table.seat(watcher)).toBeNull();
        expect(table.view(host, now).match).toBeNull();
    });

    it('does not seat a first-time watch link when dequeued', () => {
        const table = new GameNightChess('watch-one', host);

        expect(table.dequeue(watcher)).toBe(false);
        expect(table.seat(watcher)).toBeNull();
        expect(table.subjects).toEqual([host]);
    });
});
