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

    it('flips the explicit cue to the side that moves after a move', () => {
        const beforeMove = chessTurnText('w', 'w');
        const afterMove = chessTurnText('w', 'b');
        expect(beforeMove).toBe('You’re White · Your turn');
        expect(afterMove).toBe('You’re White · Black to move');
        expect(afterMove).not.toContain('Your turn');
        expect(chessTurnText('b', 'b')).toBe('You’re Black · Your turn');
    });

    it('keeps the cue absent for watchers and decisive results', () => {
        expect(chessTurnText(null, 'w')).not.toContain('Your turn');
        expect(chessResultText({ winner: 'w', reason: 'checkmate' })).not.toContain('Your turn');
        expect(chessResultText({ winner: 'b', reason: 'resignation' })).not.toContain('Your turn');
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

    it('keeps the turn cue in normal flow beneath the board within the phone width', () => {
        const status = phoneStyle('.game-night > .arcade-chess[open] :is([data-chess-status], [data-chess-error])');
        const boardSelector = '.game-night > .arcade-chess[open] #board';
        const source = readFileSync(new URL('../../r/45662413410ed051/lobby/arcade-chess.mjs', import.meta.url), 'utf8');
        expect(status.getPropertyValue('min-width')).toBe('0px');
        expect(status.getPropertyValue('max-width')).toBe('100%');
        expect(status.getPropertyValue('overflow-wrap')).toBe('anywhere');
        expect(phoneStyle(boardSelector).getPropertyValue('max-width')).toBe('25rem');
        // The status paragraph follows the board as a sibling in normal document flow.
        expect(source).toMatch(/data-chess-status[\s\S]*?data-chess-playing[\s\S]*?<div id="board"[\s\S]*?<\/div>[\s\S]*?<\/div>/);
        expect(source).toContain("status.textContent = chessTurnText(model.seat, match.turn)");
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

    it('keeps the turn cue visible while the reconnect pill is shown', () => {
        const pill = phoneStyle('.game-night > .arcade-chess[open] > summary .arcade-reconnect:not([hidden])');
        const status = phoneStyle('.game-night > .arcade-chess[open] :is([data-chess-status], [data-chess-error])');
        expect(pill.getPropertyValue('display')).toBe('block');
        expect(pill.getPropertyValue('max-width')).toBe('100%');
        expect(status.getPropertyValue('max-width')).toBe('100%');
        const source = readFileSync(new URL('../../r/45662413410ed051/lobby/arcade-chess.mjs', import.meta.url), 'utf8');
        expect(source).toContain("status.textContent = chessTurnText(model.seat, match.turn)");
        expect(source).toContain("status.textContent = match ? 'Reconnecting to Chess… The clocks keep running.'");
        expect(source).not.toMatch(/if\s*\(connection\s*!==\s*'ready'\)[\s\S]{0,180}status\.textContent\s*=\s*chessTurnText/);
    });
});
