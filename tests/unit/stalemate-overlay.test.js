// @vitest-environment node
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const script = readFileSync(new URL('../../scripts/stalemate-overlay/stalemate-overlay.js', import.meta.url), 'utf8');
const windows = [];
afterEach(() => { for (const window of windows.splice(0)) window.close(); });

function resultPage(prefix = '') {
    const dom = new JSDOM('<div id="endScreen" inert><span id="endScore">42</span><button id="btnRestart">Play again</button></div>', {
        url: `https://example.test${prefix}/play/TurdAnoid.html?irrelevant=1#old`,
        runScripts: 'outside-only'
    });
    const w = dom.window;
    windows.push(w);
    w.matchMedia = () => ({ matches: false });
    w.Audio = vi.fn(() => { throw new Error('Overlay must not create competing audio'); });
    const context = { fillRect() {}, fillText() {} };
    w.HTMLCanvasElement.prototype.getContext = () => context;
    w.HTMLCanvasElement.prototype.toBlob = (cb) => cb(new w.Blob(['image'], { type: 'image/png' }));
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    w.eval(script);
    const click = async () => {
        w.document.getElementById('stalemateShare').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { w, copy, click, status: () => w.document.querySelector('[role="status"]').textContent };
}

describe('Stalemate result overlay', () => {
    it.each(['', '/StalemateSite'])('shares result text and exact game link under %s without starting a second player', async (prefix) => {
        const p = resultPage(prefix);
        p.w.navigator.share = vi.fn().mockResolvedValue(undefined);
        await p.click();
        expect(p.w.navigator.share).toHaveBeenCalledWith({
            title: 'Turdanoid · Stalemate Arcade',
            text: 'I scored 42 in Turdanoid. Brick-breaker, but gross.',
            url: `https://example.test${prefix}/play/TurdAnoid.html`
        });
        expect(p.w.Audio).not.toHaveBeenCalled();
        expect(p.copy).not.toHaveBeenCalled();
        expect(p.status()).toBe('Shared.');
    });

    it('includes a ready result image along with text and destination', async () => {
        const p = resultPage();
        p.w.navigator.canShare = () => true;
        p.w.navigator.share = vi.fn().mockResolvedValue(undefined);
        p.w.document.getElementById('endScreen').removeAttribute('inert');
        // jsdom has no layout, so make the visible results screen measurable.
        Object.defineProperty(p.w.document.getElementById('endScreen'), 'offsetParent', { value: p.w.document.body });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await p.click();
        const payload = p.w.navigator.share.mock.calls[0][0];
        expect(payload.files).toHaveLength(1);
        expect(payload.files[0].name).toBe('turdanoid-score.png');
        expect(payload.text).toContain('42');
        expect(payload.url).toBe('https://example.test/play/TurdAnoid.html');
    });

    it('copies after a share failure and leaves cancellation quiet', async () => {
        const p = resultPage();
        p.w.navigator.share = vi.fn().mockRejectedValue(new Error('Native sharing unavailable'));
        await p.click();
        expect(p.copy).toHaveBeenCalledWith('I scored 42 in Turdanoid. Brick-breaker, but gross. https://example.test/play/TurdAnoid.html');
        expect(p.status()).toBe('Score and link copied.');
        p.copy.mockClear();
        p.w.navigator.share.mockRejectedValue(Object.assign(new Error('Dismissed'), { name: 'AbortError' }));
        await p.click();
        expect(p.copy).not.toHaveBeenCalled();
        expect(p.status()).toBe('Sharing cancelled.');
    });

    it('shows a selectable fallback when share and clipboard are unavailable', async () => {
        const p = resultPage('/StalemateSite');
        p.copy.mockRejectedValue(new Error('Permission denied'));
        await p.click();
        const fallback = p.w.document.querySelector('textarea');
        expect(fallback.hidden).toBe(false);
        expect(fallback.value).toContain('https://example.test/StalemateSite/play/TurdAnoid.html');
        expect(p.w.document.activeElement).toBe(fallback);
        expect(p.status()).toBe('Select and copy your score and link below.');
    });
});
