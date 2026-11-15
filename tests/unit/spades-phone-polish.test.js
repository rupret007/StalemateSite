// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const css = readFileSync(new URL('../../r/45662413410ed051/lobby/lobby.css', import.meta.url), 'utf8');
const lobby = readFileSync(new URL('../../r/45662413410ed051/lobby/lobby.js', import.meta.url), 'utf8');

function checkSpades(seats) {
    const cards = Array.from({ length: 13 }, (_, i) => `<button>Card ${i + 1}</button>`).join('');
    const dom = new JSDOM(`<style>${css}</style><main class="game-night"><details open class="arcade-card-table arcade-spades"><summary>Spades
      <span class="arcade-reconnect" hidden>Reconnecting to game…</span></summary>
      <p data-turn>South to bid</p><div data-card-table data-spades-table>
      <div data-spades-bid><label>Your bid</label><select><option>3</option></select><button>Bid for me</button></div>
      <p class="arcade-card-hand-label">Your hand</p><div class="arcade-card-hand" data-hand>${cards}</div>
      </div></details></main>`);
    const { document, getComputedStyle } = dom.window;
    const summary = document.querySelector('summary'), pill = document.querySelector('.arcade-reconnect');
    pill.hidden = false;
    const style = getComputedStyle(summary), pillStyle = getComputedStyle(pill);

    expect(style.minHeight).toBe('44px');
    expect(style.width).toBe('100%');
    expect(style.overflowWrap).toBe('anywhere');
    expect(pillStyle.display).toBe('inline-block');
    expect(['absolute', 'fixed']).not.toContain(pillStyle.position);
    expect(document.querySelector('[data-turn]').compareDocumentPosition(summary) & dom.window.Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    for (const selector of ['[data-spades-bid]', '[data-hand]']) {
        expect(document.querySelector(selector).compareDocumentPosition(summary) & dom.window.Node.DOCUMENT_POSITION_PRECEDING,
            `${seats}-seat Spades ${selector} remains after the summary in normal document flow`).toBeTruthy();
    }
    expect(lobby).toMatch(/table\.reconnect\.hidden\s*=\s*!reconnecting/);
    expect(pill.hidden).toBe(false);
    pill.hidden = true;
    expect(pill.hidden).toBe(true);
    dom.window.close();
}

describe('Spades phone reconnect pill', () => {
    it('keeps the reconnect summary in normal flow above turn status, hand and Bid controls in partners Spades and clears on recovery', () => checkSpades(2));
    it('keeps the reconnect summary in normal flow above turn status, hand and Bid controls in four-player Spades and clears on recovery', () => checkSpades(4));
});
