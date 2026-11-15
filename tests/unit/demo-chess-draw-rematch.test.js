// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GameNightChess } from '../../hangout-worker/src/game-night-chess.mjs';
import { ChessMatch } from '../../hangout-worker/arcade/games/chess-match.js';

const startedAt = 1_000;
const white = 'player-white';
const black = 'player-black';
const watcher = 'watcher';

function command(game, person, action, now = startedAt, move) {
    const { match } = game.view(person, now);
    return game.command(person, {
        version: 1,
        id: match.id,
        revision: match.revision,
        action,
        ...(move ? { move } : {})
    }, now);
}

function seatedGame() {
    const game = new GameNightChess('chess-demo', white);
    expect(game.join(black, 'chess-demo', startedAt)).toBe(true);
    return game;
}

describe('demo chess draw, rematch, watcher and reconnect behavior', () => {
    it('allows a draw offer to be declined and then accepted exactly once', () => {
        const game = seatedGame();

        expect(command(game, white, 'offer-draw')).toEqual({ ok: true });
        expect(game.view(black, startedAt).match.drawOffer).toBe('w');
        expect(command(game, black, 'decline-draw')).toEqual({ ok: true });
        expect(game.view(white, startedAt).match).toMatchObject({ drawOffer: null, result: null });

        expect(command(game, black, 'offer-draw')).toEqual({ ok: true });
        const revisionBeforeAccept = game.view(white, startedAt).match.revision;
        expect(command(game, white, 'accept-draw')).toEqual({ ok: true });
        const finished = game.view(black, startedAt).match;
        expect(finished.result).toEqual({ winner: null, reason: 'Draw by agreement' });
        expect(finished.drawOffer).toBeNull();
        expect(finished.revision).toBe(revisionBeforeAccept + 1);
        expect(command(game, black, 'accept-draw')).toEqual({ ok: false, reason: 'finished' });
        expect(game.view(white, startedAt).match.revision).toBe(finished.revision);
    });

    it('records resignation and starts a mutually approved rematch with colors swapped', () => {
        const game = seatedGame();
        expect(command(game, white, 'resign')).toEqual({ ok: true });
        expect(game.view(black, startedAt).match.result).toMatchObject({ winner: 'b', reason: 'Resignation' });

        expect(game.requestRematch(white, 'chess-demo', 'chess-rematch', startedAt)).toBe(true);
        expect(game.requestRematch(black, 'chess-demo', 'chess-rematch', startedAt)).toBe(true);
        expect(game.view(white, startedAt)).toMatchObject({ id: 'chess-rematch', seat: 'b', match: { result: null, moves: [] } });
        expect(game.view(black, startedAt)).toMatchObject({ id: 'chess-rematch', seat: 'w', match: { result: null, moves: [] } });
    });

    it('rejects watcher draw offers, resignations and moves', () => {
        const game = seatedGame();
        for (const action of ['offer-draw', 'resign', 'move']) {
            expect(command(game, watcher, action, startedAt, 'e2e4')).toEqual({ ok: false, reason: 'unavailable' });
        }
        expect(game.view(white, startedAt).match).toMatchObject({ revision: 0, moves: [], result: null, drawOffer: null });
    });

    it('keeps a reconnecting seated player color and clocks', () => {
        const game = seatedGame();
        expect(command(game, white, 'move', startedAt + 2_000, 'e2e4')).toEqual({ ok: true });
        const before = game.view(white, startedAt + 3_000);
        const restored = GameNightChess.restore(JSON.parse(JSON.stringify(game.checkpoint())));
        expect(restored.view(white, startedAt + 3_000)).toEqual(before);
        expect(restored.view(white, startedAt + 3_000).seat).toBe('w');
        expect(restored.view(black, startedAt + 3_000).seat).toBe('b');
        expect(restored.view(black, startedAt + 3_000).match.clock).toEqual(before.match.clock);

        const directMatch = ChessMatch.restore(restored.checkpoint().match);
        expect(directMatch.view(startedAt + 3_000).clock).toEqual(before.match.clock);
    });
});
