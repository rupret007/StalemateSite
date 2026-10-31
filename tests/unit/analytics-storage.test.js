// @vitest-environment node
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../js/count.js', import.meta.url), 'utf8');
const windows = [];
function boot({ denied = false, toggle = false, optOut = false } = {}) {
    const dom = new JSDOM('<script data-goatcounter="https://stalemate.goatcounter.com/count"></script>', {
        url: 'https://stalemate.band/' + (toggle ? '#toggle-goatcounter' : ''), runScripts: 'outside-only', pretendToBeVisual: true
    });
    const w = dom.window; windows.push(w);
    if (optOut) w.localStorage.setItem('skipgc', 't');
    if (denied === 'write') {
        const storage = w.localStorage;
        Object.defineProperty(w, 'localStorage', { value: {
            getItem: storage.getItem.bind(storage), removeItem: storage.removeItem.bind(storage),
            setItem() { throw new w.DOMException('Storage full', 'QuotaExceededError'); }
        } });
    } else if (denied) Object.defineProperty(w, 'localStorage', { get() { throw new w.DOMException('Storage denied', 'SecurityError'); } });
    const send = vi.fn(() => true); Object.defineProperty(w.navigator, 'sendBeacon', { value: send });
    w.alert = vi.fn(); w.console.warn = vi.fn(); w.goatcounter = { no_onload: true };
    return { w, send, run: () => w.eval(source) };
}
afterEach(() => windows.splice(0).forEach(w => w.close()));

describe('analytics storage failure', () => {
    it.each([false, true])('skips counting without throwing when storage is denied (toggle=%s)', toggle => {
        const page = boot({ denied: true, toggle });
        expect(page.run).not.toThrow();
        expect(() => page.w.goatcounter.count({ path: 'test', event: true })).not.toThrow();
        expect(page.send).not.toHaveBeenCalled();
        expect(page.w.document.querySelector('img')).toBeNull();
    });

    it('continues honoring a stored opt-out and permits normal counting otherwise', () => {
        for (const optOut of [true, false]) {
            const page = boot({ optOut }); page.run(); page.w.goatcounter.count({ path: 'test', event: true });
            expect(page.send).toHaveBeenCalledTimes(optOut ? 0 : 1);
        }
    });

    it('still toggles and persists the existing opt-out when storage is available', () => {
        const page = boot({ toggle: true }); page.run();
        expect(page.w.localStorage.getItem('skipgc')).toBe('t');
        page.run(); expect(page.w.localStorage.getItem('skipgc')).toBeNull();
    });

    it('keeps a requested opt-out for this page when its storage write fails', () => {
        const page = boot({ denied: 'write', toggle: true }); page.run();
        page.w.goatcounter.count({ path: 'test', event: true });
        expect(page.send).not.toHaveBeenCalled();
    });
});
