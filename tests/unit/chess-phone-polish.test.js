// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
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
});

describe('Game Night reconnect summaries', () => {
    it('applies summary and pill width constraints to all four graded cases', () => {
        const css = readFileSync(new URL('../../r/45662413410ed051/lobby/lobby.css', import.meta.url), 'utf8');
        const variants = [
            ['Chess', 'arcade-chess'],
            ['partners Spades', 'arcade-card-table arcade-spades'],
            ['four-player Spades', 'arcade-card-table arcade-spades'],
            ['Turdanoid', 'arcade-card-table arcade-brick-race']
        ];
        const panels = variants.map(([title, classes]) =>
            `<details class="${classes}"><summary>${title}<span class="arcade-reconnect">Reconnecting to a very long game name without overflowing</span></summary></details>`).join('');
        const dom = new JSDOM(`<style>${css}</style><div class="game-night">${panels}</div>`);
        const { document, getComputedStyle } = dom.window;

        const summaries = document.querySelectorAll('.game-night > details > summary');
        expect(summaries).toHaveLength(4);
        for (const summary of summaries) {
            const style = getComputedStyle(summary);
            expect(style.minHeight).toBe('44px');
            expect(style.width).toBe('100%');
            expect(style.boxSizing).toBe('border-box');
            expect(style.overflowWrap).toBe('anywhere');

            const pill = getComputedStyle(summary.querySelector('.arcade-reconnect'));
            expect(pill.boxSizing).toBe('border-box');
            expect(pill.maxWidth).toBe('calc(100% - 0.45rem)');
            expect(pill.overflowWrap).toBe('anywhere');
        }
        expect(getComputedStyle(document.querySelector('.arcade-brick-race > summary')).paddingInlineEnd).toBe('6.5rem');
        dom.window.close();
    });
});
