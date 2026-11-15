// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chessResultText, chessTurnText } from '../../r/45662413410ed051/lobby/arcade-chess.mjs';

describe('Chess phone status copy', () => {
    it('uses the exact seated and watcher turn lines', () => {
        expect(chessTurnText('b', 'w')).toBe('You’re Black · White to move');
        expect(chessTurnText(null, 'w')).toBe('Watching · White to move');
    });

    it('makes checkmate and draw outcomes explicit', () => {
        expect(chessResultText({ winner: 'w', reason: 'checkmate' })).toBe('Checkmate · White wins');
        expect(chessResultText({ winner: null, reason: 'stalemate' })).toBe('Draw · stalemate');
    });

    it('keeps resignation distinct from checkmate', () => {
        expect(chessResultText({ winner: 'w', reason: 'resignation' })).toBe('White wins · resignation');
    });
});
