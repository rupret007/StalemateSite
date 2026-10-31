// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(new URL('../../qr/script.js', import.meta.url), 'utf8');
const prefSource = readFileSync(path.join(repoRoot, 'js/music-preference.js'), 'utf8');
const windows = [];
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function boot(playFirst, options) {
    const dom = new JSDOM('<audio data-qr-audio></audio><button data-qr-play></button><p data-qr-status></p>', {
        url: 'https://stalemate.band/qr/', runScripts: 'outside-only'
    });
    const w = dom.window; windows.push(w);
    Object.defineProperty(w.document, 'readyState', { value: 'complete' });
    if (options && options.musicPref === 'off') {
        const store = new Map([['stalemate.music', 'off']]);
        Object.defineProperty(w, 'localStorage', {
            value: {
                getItem: (k) => store.get(k) ?? null,
                setItem: (k, v) => store.set(k, v)
            },
            configurable: true
        });
        w.eval(prefSource);
    }
    const audio = w.document.querySelector('audio'), button = w.document.querySelector('button');
    const state = { paused: true, error: null }, calls = [];
    Object.defineProperties(audio, { paused: { get: () => state.paused }, error: { get: () => state.error } });
    audio.play = vi.fn(playFirst || (() => Promise.resolve()));
    audio.load = vi.fn(() => { calls.push('load'); state.error = null; });
    audio.pause = vi.fn(() => { state.paused = true; audio.dispatchEvent(new w.Event('pause')); });
    w.goatcounter = { count: vi.fn() };
    w.eval(source);
    return { w, audio, button, state, calls, status: w.document.querySelector('p') };
}
afterEach(() => windows.splice(0).forEach(w => w.close()));

describe('QR audio recovery', () => {
    it('does not autoplay when site music preference is off', async () => {
        const page = boot(undefined, { musicPref: 'off' });
        await settle();
        expect(page.audio.play).not.toHaveBeenCalled();
        expect(page.state.paused).toBe(true);
    });

    it('distinguishes autoplay blocking and retries from the user gesture without reloading good media', async () => {
        const page = boot(() => Promise.reject(Object.assign(new Error('Gesture needed'), { name: 'NotAllowedError' })));
        await settle();
        expect(page.status.textContent).toMatch(/tap|play/i);
        expect(page.status.textContent).not.toMatch(/connection|load|retry/i);
        page.audio.play.mockResolvedValueOnce(); page.button.click(); await settle();
        expect(page.audio.play).toHaveBeenCalledTimes(2);
        expect(page.audio.load).not.toHaveBeenCalled();
    });

    it('offers a deliberate reload and recovers after a media download failure', async () => {
        const page = boot();
        page.state.error = { code: 4 }; page.audio.dispatchEvent(new page.w.Event('error'));
        expect(page.button.textContent).toContain('Retry Manic');
        expect(page.status.textContent).toMatch(/load.*Manic.*connection.*retry/i);
        page.audio.play.mockImplementationOnce(() => { page.calls.push('play'); return Promise.resolve(); });
        page.button.click(); await settle();
        expect(page.calls).toEqual(['load', 'play']);
        page.state.paused = false; page.audio.dispatchEvent(new page.w.Event('playing'));
        expect(page.button.getAttribute('aria-pressed')).toBe('true');
        expect(page.status.textContent).toBe('');
        page.button.click(); expect(page.audio.pause).toHaveBeenCalledOnce();
    });

    it('does not let an older rejected play request overwrite a newer successful retry', async () => {
        let rejectFirst;
        const page = boot(() => new Promise((_, reject) => { rejectFirst = reject; }));
        page.state.error = { code: 2 }; page.audio.dispatchEvent(new page.w.Event('error'));
        page.audio.play.mockResolvedValueOnce(); page.button.click();
        page.state.paused = false; page.audio.dispatchEvent(new page.w.Event('playing'));
        rejectFirst(Object.assign(new Error('Old gesture rejection'), { name: 'NotAllowedError' }));
        await settle(); expect(page.status.textContent).toBe('');
        expect(page.button.getAttribute('aria-pressed')).toBe('true');
    });

    it('reports a synchronous play failure as a load problem', () => {
        const page = boot();
        page.audio.play.mockImplementationOnce(() => { throw Object.assign(new Error('Unsupported media'), { name: 'NotSupportedError' }); });
        expect(() => page.button.click()).not.toThrow();
        expect(page.button.textContent).toContain('Retry Manic');
        expect(page.status.textContent).toMatch(/connection.*retry/i);
    });
});
