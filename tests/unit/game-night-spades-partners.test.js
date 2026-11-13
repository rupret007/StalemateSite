// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GameNightSpadesPartners, GameNightTurdSpades } from '../../hangout-worker/src/game-night-turdspades.mjs';

const matchId = 'spades-partner-fixture';
const human = { south: 'host', west: 'friend' };
const request = (match, fields) => ({ version: match.version, id: match.id, revision: match.revision, ...fields });

function joinedTable() {
    const table = new GameNightSpadesPartners(matchId, human.south);
    expect(table.hasGuestSeat(matchId, human.south)).toBe(true);
    expect(table.join(human.west, matchId, 0, 'next')).toBe(true);
    return table;
}

describe('TurdSpades with computer partners', () => {
    it('fills the two human seats and keeps each hand private', () => {
        const table = joinedTable();
        expect(table.subjects).toEqual(Object.values(human));
        expect(table.join('extra', matchId, 0, 'next')).toBe(false);
        const host = table.view(human.south), friend = table.view(human.west), spectator = table.view('extra');
        expect(host).toMatchObject({ mode: 'partners', occupied: ['south', 'west'], seat: 'south', waiting: false });
        expect(friend.seat).toBe('west');
        expect(host.match.hand).toHaveLength(13);
        expect(friend.match.hand).toHaveLength(13);
        expect(new Set([...host.match.hand, ...friend.match.hand].map(card => card.id)).size).toBe(26);
        expect(spectator.match.hand).toEqual([]);
        expect(table.command('extra', request(spectator.match, { action: 'bid', bid: 13 })).ok).toBe(false);

        // Older Workers can read the four-seat checkpoint without treating a
        // computer as an admitted beta session or a real room participant.
        const { mode, ...olderCheckpoint } = table.checkpoint();
        expect(mode).toBe('partners');
        expect(GameNightTurdSpades.restore(olderCheckpoint).subjects).toEqual(['host', 'friend', '@cpu:north', '@cpu:east']);
    });

    it('runs legal CPU turns through a complete round, restores hands and rematches with two votes', () => {
        let table = joinedTable();
        for (let turn = 0; turn < 28; turn++) {
            const open = table.view('spectator').match;
            const subject = human[open.turn];
            expect(subject).toBeTruthy();
            const match = table.view(subject).match;
            const action = match.phase === 'bid' ? { action: 'bid', bid: 3 }
                : { action: 'play', card: match.hand.find(card => card.playable).id };
            expect(table.command(subject, request(match, action))).toEqual({ ok: true });
            if (turn === 8) {
                const restored = GameNightSpadesPartners.restore(table.checkpoint());
                for (const viewer of [...Object.values(human), 'spectator']) expect(restored.view(viewer)).toEqual(table.view(viewer));
                table = restored;
            }
        }
        const scored = table.view(human.south).match;
        expect(scored.phase).toBe('round-end');
        expect(Object.values(scored.tricks).reduce((total, value) => total + value, 0)).toBe(13);
        expect(scored.bids.north).not.toBeNull();
        expect(scored.bids.east).not.toBeNull();
        expect(table.view(human.west).match.scores).toEqual(scored.scores);
        expect(table.command(human.south, request(scored, { action: 'resign' })).ok).toBe(true);
        expect(table.requestRematch(human.south, matchId, 'spades-next-fixture', 1)).toBe(true);
        expect(table.requestRematch(human.west, matchId, 'spades-next-fixture', 1)).toBe(true);
        const next = table.view(human.south);
        expect(next).toMatchObject({ id: 'spades-next-fixture', seat: 'west', match: { round: 1, phase: 'bid', scores: [0, 0] } });
        expect(next.match.hand).toHaveLength(13);
    });
});
