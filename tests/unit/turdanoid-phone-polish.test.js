// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const css = readFileSync(new URL('../../r/45662413410ed051/lobby/lobby.css', import.meta.url), 'utf8');
const lobby = readFileSync(new URL('../../r/45662413410ed051/lobby/lobby.js', import.meta.url), 'utf8');

describe('Turdanoid phone reconnect pill', () => {
    it('keeps the reconnect summary in normal flow above turn status and paddle controls, then clears on recovery', () => {
        const dom = new JSDOM(`<style>${css}</style><main class="game-night"><details open class="arcade-card-table arcade-brick-race"><summary>Turdanoid Brick Race
          <span class="arcade-reconnect" hidden>Reconnecting to game…</span></summary>
          <p data-turn>Your turn</p><button data-brick-leave>Leave race</button>
          <div data-card-table data-brick-match><div class="brick-race-layout">
          <div class="brick-race-board" data-paddle aria-label="Paddle controls"></div>
          <div class="brick-race-rail"><time>1:23</time><button data-paddle-control>Launch ball</button></div>
          </div></div></details></main>`);
        const { document, getComputedStyle, Node } = dom.window;
        const summary = document.querySelector('summary'), pill = document.querySelector('.arcade-reconnect');
        pill.hidden = false;
        const summaryStyle = getComputedStyle(summary), pillStyle = getComputedStyle(pill);

        expect(summaryStyle.minHeight).toBe('44px');
        expect(summaryStyle.width).toBe('100%');
        expect(summaryStyle.overflowWrap).toBe('anywhere');
        expect(summaryStyle.paddingInlineEnd).toBe('6.5rem');
        expect(pillStyle.display).toBe('inline-block');
        expect(['absolute', 'fixed']).not.toContain(pillStyle.position);
        for (const selector of ['[data-turn]', '[data-paddle]', '[data-paddle-control]']) {
            expect(document.querySelector(selector).compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_PRECEDING,
                `Turdanoid ${selector} remains after the summary in normal document flow`).toBeTruthy();
        }
        expect(lobby).toMatch(/table\.reconnect\.hidden\s*=\s*!reconnecting/);
        expect(pill.hidden).toBe(false);
        pill.hidden = true;
        expect(pill.hidden).toBe(true);
        dom.window.close();
    });
});
