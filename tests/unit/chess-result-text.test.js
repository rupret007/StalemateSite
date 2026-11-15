// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chessResultText } from '../../r/45662413410ed051/lobby/arcade-chess.mjs';

const perspectives = ['winner', 'loser', 'watcher'];

describe('chess result copy', () => {
    it.each([
        [{ winner: 'w', reason: 'Checkmate' }, 'Checkmate · White wins'],
        [{ winner: 'b', reason: 'Resignation' }, 'Black wins · Resignation'],
        [{ winner: null, reason: 'Threefold repetition' }, 'Draw · Threefold repetition'],
        [{ winner: null, reason: 'Stalemate' }, 'Draw · Stalemate'],
        [{ winner: 'w', reason: 'Opponent disconnected' }, 'White wins · Opponent disconnected']
    ])('renders %o for winner, loser, and watcher', (result, expected) => {
        for (const perspective of perspectives) {
            expect(chessResultText(result), perspective).toBe(expected);
        }
    });
});
