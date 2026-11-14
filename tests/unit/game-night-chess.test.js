// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GameNightChess } from '../../hangout-worker/src/game-night-chess.mjs';

const now = 1000;
const white = 'member-one';
const black = 'member-two';

function send(game, person, action, move) {
    const { match } = game.view(person, now);
    return game.command(person, { version: 1, id: match.id, revision: match.revision, action, move }, now);
}

describe('Game Night Chess seat and rematch lifecycle', () => {
    it('waits for a second distinct admitted subject and projects seats per viewer', () => {
        const game = new GameNightChess('chess-one', white);
        expect(game.deadline).toBeNull();
        expect(game.join(white, 'chess-one', now)).toBe(false);
        expect(game.join(black, 'chess-old', now)).toBe(false);
        expect(game.join(black, 'chess-one', now)).toBe(true);
        expect(game.join('member-three', 'chess-one', now)).toBe(false);
        expect(game.deadline).toBeGreaterThan(now);
        expect(game.view(white, now).seat).toBe('w');
        expect(game.view(black, now).seat).toBe('b');
        const spectator = game.view('member-three', now);
        expect(spectator.seat).toBeNull();
        expect(JSON.stringify(spectator)).not.toContain(white);
        expect(JSON.stringify(spectator)).not.toContain(black);
        expect(send(game, 'member-three', 'move', 'e2e4').reason).toBe('unavailable');
        expect(send(game, white, 'move', 'e2e4').ok).toBe(true);
        expect(game.view(black, now).match).toMatchObject({ moves: ['e2e4'], turn: 'b' });
    });

    it('restores both seats, board history and server time after a restart', () => {
        const game = new GameNightChess('chess-one', white);
        game.join(black, 'chess-one', now);
        send(game, white, 'move', 'e2e4');
        const restored = GameNightChess.restore(JSON.parse(JSON.stringify(game.checkpoint())));
        expect(restored.view(black, now + 2000)).toEqual(game.view(black, now + 2000));
        expect(restored.deadline).toBe(game.deadline);
        expect(send(restored, black, 'move', 'c7c5').ok).toBe(true);
    });

    it('claims a 50-move draw after quiet moves without repeating a position three times', () => {
        const game = new GameNightChess('chess-one', white);
        game.join(black, 'chess-one', now);
        // Open with two pawns, then play 100 plies without a pawn move or capture.
        const moves = `
            e2e4 e7e5 f1d3 e8e7 g1f3 e7e6 d3e2 b8c6 h1g1 d8f6 e2b5 f6h4
            g1f1 h4g4 e1e2 g8h6 b5a4 c6d4 e2e1 f8a3 f3h4 h8d8 f1g1 d4e2
            a4c6 a3d6 g1h1 d8e8 h4f5 a8b8 f5h4 e8f8 h4f3 h6f5 c6a4 e6f6
            b1c3 g4f4 c3b5 f4g4 b5a3 b8a8 f3g5 f5e3 a3b1 a8b8 a4b5 f8d8
            b5a4 g4f5 g5f3 f5f4 h1g1 d6a3 a4b3 e3g4 g1f1 f4g5 b3c4 e2c3
            f1h1 g5f5 e1f1 a3c5 c4d3 c5e3 f1g1 f6g6 d1e1 c3d1 g1f1 d8g8
            d3b5 g4f6 f3g1 b8a8 b5c4 f6g4 c4a6 e3g5 g1f3 g6f6 b1c3 a8b8
            a1b1 g8h8 c3a4 d1c3 a6c4 h8g8 c4a6 g8d8 f3d4 f5f4 h1g1 f4f3
            d4b5 b8a8 e1d1 f6e6 b5d6 d8e8
        `.trim().split(/\s+/);
        for (const [i, move] of moves.entries()) {
            const player = i % 2 ? black : white;
            if (i === moves.length - 1) {
                expect(send(game, player, 'claim-draw')).toEqual({ ok: false, reason: 'no-draw-claim' });
            }
            expect(send(game, player, 'move', move).ok, move).toBe(true);
        }
        expect(game.view(white, now).match.result).toBeNull();
        expect(send(game, white, 'claim-draw')).toEqual({ ok: true });
        expect(game.view(black, now).match).toMatchObject({ moves, result: { winner: null, reason: '50-move rule' } });
    });

    it('requires both seated players to agree to a rematch and keeps their colors', () => {
        const game = new GameNightChess('chess-one', white);
        game.join(black, 'chess-one', now);
        expect(game.requestRematch(white, 'chess-one', 'chess-two', now)).toBe(false);
        expect(send(game, black, 'resign').ok).toBe(true);
        expect(game.requestRematch(white, 'chess-one', 'chess-two', now)).toBe(true);
        const restored = GameNightChess.restore(game.checkpoint());
        expect(restored.requestRematch(white, 'chess-one', 'chess-two', now)).toBe(false);
        expect(restored.requestRematch('member-three', 'chess-one', 'chess-two', now)).toBe(false);
        expect(restored.requestRematch(black, 'chess-one', 'chess-two', now + 500)).toBe(true);
        expect(restored.view(black, now + 500)).toMatchObject({
            id: 'chess-two', tableId: 'chess-one', seat: 'b', rematch: null, match: { moves: [], result: null, turn: 'w' }
        });
        expect(restored.seat(white)).toBe('w');
        expect(restored.command(black, { version: 1, id: 'chess-one', revision: 0, action: 'move', move: 'e2e4' }, now + 500).reason)
            .toBe('match-changed');
    });
});
