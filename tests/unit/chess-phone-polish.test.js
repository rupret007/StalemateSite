// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chessResultText, chessTurnText } from '../../r/45662413410ed051/lobby/arcade-chess.mjs';

describe('Chess phone status copy', () => {
    it('explicitly cues the seated player when it is their turn', () => {
        expect(chessTurnText('b', 'b')).toBe('You’re Black · Your turn');
        expect(chessTurnText('w', 'w')).toBe('You’re White · Your turn');
    });

    it('uses the exact seated and watcher turn lines', () => {
        expect(chessTurnText('b', 'w')).toBe('You’re Black · White to move');
        expect(chessTurnText(null, 'w')).toBe('Watching · White to move');
    });

    it('makes checkmate and draw outcomes explicit', () => {
        expect(chessResultText({ winner: 'w', reason: 'checkmate' })).toBe('Checkmate · White wins');
        expect(chessResultText({ winner: null, reason: 'stalemate' })).toBe('Draw · stalemate');
    });
});
