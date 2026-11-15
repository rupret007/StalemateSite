// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GameNightSpadesPartners, GameNightTurdSpades } from '../../hangout-worker/src/game-night-turdspades.mjs';
import { suggestSpadesBid } from '../../hangout-worker/arcade/games/turdspades-engine.js';
import { suggestSpadesBid as suggestPlayBid } from '../../play/games/turdspades-engine.js';

const nilHand = ['2S', '3S', '4S', '2H', '3H', '4H', '5H', '2D', '3D', '4D', '5D', '2C', '3C']
    .map(card => ({ rank: card.slice(0, -1), suit: card.slice(-1) }));
const aceHand = ['AS', 'AH', 'AD', '2H', '3H', '4H', '5D', '6D', '7D', '2C', '3C', '4C', '5C']
    .map(card => ({ rank: card.slice(0, -1), suit: card.slice(-1) }));

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
        const finished = table.checkpoint();
        for (const order of [[human.south, human.west], [human.west, human.south]]) {
            const rematch = GameNightSpadesPartners.restore(finished);
            expect(rematch.requestRematch(order[0], matchId, 'spades-next-fixture', 1)).toBe(true);
            expect(rematch.view(human.south).id).toBe(matchId);
            expect(rematch.view(human.south).match.result).toBeTruthy();
            expect(rematch.requestRematch(order[1], matchId, 'spades-next-fixture', 1)).toBe(true);
            const next = rematch.view(human.south);
            expect(next).toMatchObject({ id: 'spades-next-fixture', seat: 'south', match: { round: 1, phase: 'bid', scores: [0, 0] } });
            const west = rematch.view(human.west);
            expect(west).toMatchObject({ id: 'spades-next-fixture', seat: 'west', match: { round: 1, phase: 'bid', scores: [0, 0] } });
            const dealt = rematch.checkpoint().match.hands;
            expect(next.match.hand.map(card => card.id).sort((a, b) => a - b)).toEqual([...dealt.south].sort((a, b) => a - b));
            expect(west.match.hand.map(card => card.id).sort((a, b) => a - b)).toEqual([...dealt.west].sort((a, b) => a - b));
            expect(new Set([...next.match.hand, ...west.match.hand].map(card => card.id)).size).toBe(26);
            const lateWatcher = rematch.view('late-watcher');
            expect(lateWatcher.seat).toBeNull();
            expect(lateWatcher.match.hand).toEqual([]);
        }
    });

    it.each(['partners', 'four'])('projects no trick, last trick or last winner while bidding round 2, after a reconnect and after a rematch in %s mode', mode => {
        const id = `spades-stale-${mode}-fixture`, nextId = `spades-stale-${mode}-next`;
        const subjects = mode === 'partners' ? human : { south: 'host', west: 'west-player', north: 'north-player', east: 'east-player' };
        let table = mode === 'partners' ? new GameNightSpadesPartners(id, 'host') : new GameNightTurdSpades(id, 'host');
        for (const [position, subject] of Object.entries(subjects)) {
            if (subject !== 'host') expect(table.join(subject, id, 0, mode === 'partners' ? 'next' : position)).toBe(true);
        }
        const act = () => {
            const subject = subjects[table.view('spectator').match.turn];
            const match = table.view(subject).match;
            const action = match.phase === 'bid' ? { action: 'bid', bid: 3 }
                : { action: 'play', card: match.hand.find(card => card.playable).id };
            expect(table.command(subject, request(match, action))).toEqual({ ok: true });
        };
        const expectCleanBid = round => {
            for (const viewer of [...Object.values(subjects), 'spectator']) {
                const view = table.view(viewer);
                expect(view.match).toMatchObject({ round, phase: 'bid', trick: [], lastTrick: [], lastWinner: null, roundResult: null });
                expect(Object.values(view.match.tricks)).toEqual([0, 0, 0, 0]);
                expect(view.seat ?? null).toBe(Object.keys(subjects).find(position => subjects[position] === viewer) ?? null);
                if (viewer === 'spectator') {
                    expect(view.match.hand).toEqual([]);
                    expect(view.match.canBid).toBe(false);
                }
            }
        };
        for (let turn = 0; turn < 60 && table.view('spectator').match.phase !== 'round-end'; turn++) act();
        const scored = table.view('host').match;
        expect(scored).toMatchObject({ phase: 'round-end', trick: [] });
        expect(scored.lastTrick).toHaveLength(4);
        expect(scored.lastWinner).not.toBeNull();

        expect(table.command('host', request(scored, { action: 'next-round' }))).toEqual({ ok: true });
        expectCleanBid(2);
        table = (mode === 'partners' ? GameNightSpadesPartners : GameNightTurdSpades).restore(table.checkpoint());
        expectCleanBid(2);

        while (table.view('spectator').match.phase === 'bid') act();
        for (let turn = 0; turn < 6; turn++) act();
        const playing = table.view('host').match;
        expect(playing.trick.length + playing.lastTrick.length).toBeGreaterThan(0);
        expect(table.command('host', request(playing, { action: 'resign' })).ok).toBe(true);
        for (const subject of Object.values(subjects)) expect(table.requestRematch(subject, id, nextId, 1)).toBe(true);
        expect(table.view('host')).toMatchObject({ id: nextId, seat: 'south' });
        expectCleanBid(1);
    });

    it('suggests Nil for a blank hand and a stable 1–9 bid for aces', () => {
        expect(suggestSpadesBid(nilHand)).toBe(0);
        expect(suggestPlayBid(nilHand)).toBe(0);
        expect(suggestSpadesBid(aceHand)).toBe(suggestSpadesBid(aceHand));
        expect(suggestSpadesBid(aceHand)).toBeGreaterThanOrEqual(1);
        expect(suggestSpadesBid(aceHand)).toBeLessThanOrEqual(9);
        expect(suggestPlayBid(aceHand)).toBe(suggestSpadesBid(aceHand));
    });

    it('accepts the suggested West bid', () => {
        const table = joinedTable();
        const friend = table.view(human.west).match;
        const bid = suggestSpadesBid(friend.hand);
        expect(table.command(human.west, request(friend, { action: 'bid', bid }))).toEqual({ ok: true });
        expect(table.view(human.west).match.bids.west).toBe(bid);
    });
});
