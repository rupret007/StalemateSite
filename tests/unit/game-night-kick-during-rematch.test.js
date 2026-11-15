// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createGameNightTable } from '../../hangout-worker/src/game-night-table.mjs';

class Match {
    constructor(id, isFinished = false) { this.id = id; this.isFinished = isFinished; }
    checkpoint() { return { id: this.id, isFinished: this.isFinished }; }
    static restore(record) { return new Match(record.id, record.isFinished); }
}

const Table = createGameNightTable({
    name: 'fixture', version: 1, Match, sides: ['one', 'two', 'three'], minSeats: 2,
    finished: match => match.isFinished, project: match => match.checkpoint()
});

function checkpoint(isFinished) {
    const table = new Table('match-12345', 'host');
    const record = table.checkpoint();
    record.match = new Match(record.id, isFinished).checkpoint();
    return record;
}

describe('Game Night restore occupancy during rematch', () => {
    it('rejects an active match checkpoint with fewer than the minimum occupied seats', () => {
        expect(() => Table.restore(checkpoint(false))).toThrow(/Invalid match seats/);
    });

    it('allows a finished match checkpoint with fewer than the minimum occupied seats', () => {
        expect(Table.restore(checkpoint(true)).checkpoint().match).toEqual({ id: 'match-12345', isFinished: true });
    });
});
