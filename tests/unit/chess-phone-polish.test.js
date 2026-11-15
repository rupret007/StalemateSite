// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { chessResultText, chessTurnText } from '../../r/45662413410ed051/lobby/arcade-chess.mjs';

const css = readFileSync(new URL('../../r/45662413410ed051/lobby/lobby.css', import.meta.url), 'utf8');
const document = new JSDOM('<style></style>').window.document;
document.querySelector('style').textContent = css;
const phoneRules = [...document.styleSheets[0].cssRules]
    .filter(rule => rule.conditionText === '(max-width: 900px)')
    .flatMap(rule => [...rule.cssRules]);
const phoneStyle = selector => phoneRules.find(rule => rule.selectorText === selector)?.style;

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

describe('Chess 390×844 layout bounds', () => {
    it('fits every board square in a 44px target with a 17px scrollbar', () => {
        const pane = phoneStyle('.chat > .game-night:has(> .arcade-chess[open] [data-chess-playing]:not([hidden]))');
        const panel = phoneStyle('.game-night.game-night:has(> .arcade-chess[open] [data-chess-playing]:not([hidden])) > .arcade-chess');
        const board = phoneStyle('.game-night > .arcade-chess[open] #board');
        expect(parseFloat(pane.getPropertyValue('padding-inline'))).toBe(0);
        expect(panel.getPropertyValue('width')).toBe('100%');
        expect(panel.getPropertyValue('padding-inline')).toBe('4px');
        expect(board.getPropertyValue('width')).toBe('100%');
        expect(board.getPropertyValue('max-width')).toBe('25rem');
        // The panel and board each have a 1px border in their base styles.
        const available = 390 - 17 - 2 - 2 * parseFloat(panel.getPropertyValue('padding-inline')) - 2;
        const boardWidth = Math.min(available, 25 * 16);
        expect(boardWidth / 8).toBeGreaterThanOrEqual(44);
        expect(boardWidth).toBeLessThanOrEqual(390 - 17);
    });

    it('keeps reconnect and completed-match actions in the scrollable pane', () => {
        const pane = phoneStyle('.game-night:has(> .arcade-chess[open])');
        const pill = phoneStyle('.game-night > .arcade-chess[open] > summary .arcade-reconnect:not([hidden])');
        const action = phoneStyle('.game-night > .arcade-chess[open] :is([data-chess-primary], [data-chess-start-rematch])');
        expect(pane.getPropertyValue('overflow-y')).toBe('auto');
        expect(pane.getPropertyValue('overflow-x')).toBe('hidden');
        expect(pill.getPropertyValue('display')).toBe('block');
        expect(pill.getPropertyValue('max-width')).toBe('100%');
        expect(action.getPropertyValue('width')).toBe('100%');
        expect(parseFloat(action.getPropertyValue('min-height'))).toBeGreaterThanOrEqual(44);
        const panelWidth = 390 - 17 - 2;
        expect(panelWidth).toBeLessThanOrEqual(390);
    });
});
