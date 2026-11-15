// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GameNightSpadesPartners, GameNightTurdSpades } from '../../hangout-worker/src/game-night-turdspades.mjs';
import { GameNightCrapeights } from '../../hangout-worker/src/game-night-crapeights.mjs';

const request = (match, fields) => ({ version: match.version, id: match.id, revision: match.revision, ...fields });
const unknown = 'privacy-watcher-not-seated';

function expectPrivateViews(table, players) {
    const record = table.checkpoint();
    const viewers = [null, unknown, ...players];
    for (const viewer of viewers) {
        const view = table.view(viewer);
        expect(view.seat).toBe(viewer ? Object.keys(record.seats).find(seat => record.seats[seat] === viewer) ?? null : null);
        if (!view.match || !record.match) continue;
        const privateHands = record.match.hands;
        for (const [seat, ids] of Object.entries(privateHands)) {
            const shown = view.match.hand.map(card => card.id);
            if (view.seat === seat) {
                expect([...shown].sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
            } else {
                for (const id of ids) expect(shown).not.toContain(id);
            }
        }
        // The engines must expose only the viewer's projected hand, never their
        // private hand map or the undealt/draw pile.
        expect(view.match).not.toHaveProperty('hands');
        expect(view.match).not.toHaveProperty('deck');
    }
}

function joinFullTable(Table, id, players, positions) {
    const table = new Table(id, players[0]);
    expectPrivateViews(table, players);
    for (let index = 1; index < players.length; index++) {
        expect(table.join(players[index], id, 0, positions[index])).toBe(true);
        expectPrivateViews(table, players);
    }
    expect(table.checkpoint().match).not.toBeNull();
    expectPrivateViews(table, players);
    return table;
}

function playSpadesMove(table, players) {
    const publicMatch = table.view(null).match;
    const actor = table.checkpoint().seats[publicMatch.turn];
    const own = table.view(actor).match;
    const action = own.phase === 'bid' ? { action: 'bid', bid: 2 }
        : { action: 'play', card: own.hand.find(card => card.playable).id };
    expect(table.command(actor, request(own, action))).toEqual({ ok: true });
    expectPrivateViews(table, players);
}

function finishAndRematch(table, Table, id, nextId, players) {
    const first = players[0];
    const own = table.view(first).match;
    expect(table.command(first, request(own, { action: 'resign' })).ok).toBe(true);
    expectPrivateViews(table, players);
    for (const player of players) {
        expect(table.requestRematch(player, id, nextId, 1)).toBe(true);
        expectPrivateViews(table, players);
    }
    expect(table.view(null).id).toBe(nextId);
}

describe('demo card watcher privacy', () => {
    it.each([
        ['Spades partners', GameNightSpadesPartners, 'privacy-spades-partners', ['south-player', 'west-player'], ['south', 'next']],
        ['four-player Spades', GameNightTurdSpades, 'privacy-spades-four', ['south-player', 'west-player', 'north-player', 'east-player'], ['south', 'west', 'north', 'east']]
    ])('%s keeps every other seat hand private through play, rematch, and next-game queueing', (_name, Table, id, players, positions) => {
        const table = joinFullTable(Table, id, players, positions);
        // Bid and play across several turns, checking every projection after each action.
        for (let turn = 0; turn < 10; turn++) playSpadesMove(table, players);
        expect(table.enqueue(unknown)).toBe(true);
        expect(table.view(unknown).upNext).toBe(true);
        expectPrivateViews(table, players);
        finishAndRematch(table, Table, id, `${id}-next`, players);
        expect(table.view(unknown).upNext).toBe(true);
        expectPrivateViews(table, players);
    });

    it('keeps Crazy Eights hands private through play, rematch, and next-game queueing', () => {
        const id = 'privacy-crazy-eights';
        const players = ['eights-a-player', 'eights-b-player'];
        const table = new GameNightCrapeights(id, players[0]);
        expectPrivateViews(table, players);
        expect(table.join(players[1], id, 0, 'b')).toBe(true);
        expectPrivateViews(table, players);
        for (let turn = 0; turn < 6; turn++) {
            const publicMatch = table.view(null).match;
            const actor = table.checkpoint().seats[publicMatch.turn];
            const own = table.view(actor).match;
            const playable = own.hand.find(card => card.playable);
            const action = playable ? { action: 'play', card: playable.id, ...(playable.rank === '8' ? { suit: playable.suit } : {}) }
                : { action: 'draw' };
            const result = table.command(actor, request(own, action));
            expect(result.ok).toBe(true);
            expectPrivateViews(table, players);
        }
        expect(table.enqueue(unknown)).toBe(true);
        expect(table.view(unknown).upNext).toBe(true);
        expectPrivateViews(table, players);
        finishAndRematch(table, GameNightCrapeights, id, `${id}-next`, players);
        expect(table.view(unknown).upNext).toBe(true);
        expectPrivateViews(table, players);
    });
});
