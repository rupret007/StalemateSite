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

    it('requires both seated players to agree to a rematch and swaps their colors', () => {
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
            id: 'chess-two', seat: 'w', rematch: null, match: { moves: [], result: null, turn: 'w' }
        });
        expect(restored.seat(white)).toBe('b');
        expect(restored.command(black, { version: 1, id: 'chess-one', revision: 0, action: 'move', move: 'e2e4' }, now + 500).reason)
            .toBe('match-changed');
    });
});
