import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(repoRoot, 'countdown.js'), 'utf8');
const windows = [];
const SET_AT = '2026-10-24T16:45:00-05:00';
const BEFORE = Date.parse('2026-10-15T12:00:00-05:00');
const AFTER = Date.parse('2026-10-24T16:45:00-05:00');

function loadCountdown(markup) {
    const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, {
        runScripts: 'dangerously',
        url: 'https://rupret007.github.io/StalemateSite/'
    });
    windows.push(dom.window);
    dom.window.eval(source);
    return dom.window;
}

function nextShowMarkup() {
    return `<div class="hero-next" data-next-show data-starts-at="${SET_AT}">
        <div class="hero-countdown" data-countdown>
            <ol class="countdown-clock" data-countdown-clock hidden>
                <li><span data-countdown-days>00</span></li>
                <li><span data-countdown-hours>00</span></li>
                <li><span data-countdown-minutes>00</span></li>
                <li><span data-countdown-seconds>00</span></li>
            </ol>
        </div>
        <aside data-next-show-block>
            <p>Rockin’ October</p>
            <a href="https://rockinoctober.com">Festival info</a>
        </aside>
    </div>`;
}

afterEach(() => {
    windows.splice(0).forEach((window) => {
        window.StalemateCountdown?.stop();
        window.close();
    });
});

describe('hero countdown remaining time', () => {
    it('rolls the real homepage promotions over together while raw metadata stays evergreen', () => {
        const html = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
        const window = loadCountdown(html);
        const { document, StalemateCountdown } = window;
        for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
            expect(document.querySelector(selector).getAttribute('content')).not.toMatch(/Oct 24|Rockin/);
        }
        expect(document.querySelector('[data-next-show]').hidden).toBe(true);
        expect(document.querySelector('.header-cta').textContent).toBe('Follow the band');
        StalemateCountdown.apply(document, AFTER - 1);
        expect(document.querySelector('.header-cta').textContent).toBe('Show details');
        expect(document.querySelector('#listen-title').textContent).toBe('Homework before the show');
        expect(document.querySelector('[data-show-before]').hidden).toBe(false);
        for (const now of [AFTER, AFTER + 86400000]) {
            StalemateCountdown.apply(document, now);
            expect(document.querySelector('[data-next-show]').hidden).toBe(true);
            expect(document.querySelector('[data-show-before]').hidden).toBe(true);
            expect(document.querySelector('.header-cta').textContent).toBe('Follow the band');
            expect(document.querySelector('.header-cta').getAttribute('href')).toBe('https://www.instagram.com/stalemate.punk/');
            expect(document.querySelector('#listen-title').textContent).toBe('Learn the words');
        }
        const overlay = readFileSync(path.join(repoRoot, 'scripts/stalemate-overlay/stalemate-overlay.js'), 'utf8');
        expect(overlay).toContain(`data-starts-at="${SET_AT}"`);
        expect(overlay).not.toContain('2026-10-25T00:00:00');
    });
    it('fails closed on an invalid clock value', () => {
        const { StalemateCountdown } = loadCountdown(nextShowMarkup());
        expect(() => StalemateCountdown.remainingParts(SET_AT, Number.NaN)).toThrow(/finite timestamp/);
    });

    it('splits the remaining time before the set', () => {
        const { StalemateCountdown } = loadCountdown(nextShowMarkup());
        expect(StalemateCountdown.remainingParts(SET_AT, BEFORE)).toEqual({
            days: 9,
            hours: 4,
            minutes: 45,
            seconds: 0,
            ms: Date.parse(SET_AT) - BEFORE
        });
    });

    it('returns null at and after the set time', () => {
        const { StalemateCountdown } = loadCountdown(nextShowMarkup());
        expect(StalemateCountdown.remainingParts(SET_AT, AFTER)).toBeNull();
        expect(StalemateCountdown.remainingParts(SET_AT, AFTER + 1000)).toBeNull();
    });
});

describe('hero countdown and next-show visibility', () => {
    it('refreshes all promotions immediately when a tab becomes visible or focused', () => {
        const html = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
        const window = loadCountdown(html);
        const now = vi.spyOn(window.Date, 'now').mockReturnValue(BEFORE);
        window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
        now.mockReturnValue(AFTER);
        window.dispatchEvent(new window.Event('focus'));
        expect(window.document.querySelector('.header-cta').textContent).toBe('Follow the band');
        window.StalemateCountdown.apply(window.document, BEFORE);
        Object.defineProperty(window.document, 'hidden', { configurable: true, value: false });
        window.document.dispatchEvent(new window.Event('visibilitychange'));
        expect(window.document.querySelector('.header-cta').textContent).toBe('Follow the band');
        expect(window.document.querySelector('[data-next-show]').hidden).toBe(true);
    });
    it.each([BEFORE + 60000, AFTER])('refreshes a cached page on return at %s', (restoredAt) => {
        const window = loadCountdown(nextShowMarkup());
        const now = vi.spyOn(window.Date, 'now').mockReturnValue(BEFORE);
        const setInterval = vi.spyOn(window, 'setInterval').mockReturnValue(1);
        const clearInterval = vi.spyOn(window, 'clearInterval');
        window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
        expect(setInterval).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: true }));
        expect(clearInterval).toHaveBeenCalledWith(1);
        now.mockReturnValue(restoredAt);
        window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));

        const block = window.document.querySelector('[data-next-show]');
        if (restoredAt === AFTER) {
            expect(block.hidden).toBe(true);
            expect(setInterval).toHaveBeenCalledTimes(1);
        } else {
            expect(block.hidden).toBe(false);
            expect(block.querySelector('[data-countdown-minutes]').textContent).toBe('44');
            expect(setInterval).toHaveBeenCalledTimes(2);
            now.mockReturnValue(restoredAt + 1000);
            setInterval.mock.calls[1][0]();
            expect(block.querySelector('[data-countdown-seconds]').textContent).toBe('59');
        }
    });

    it('fills the clock and keeps the next-show block before the set', () => {
        const { document, StalemateCountdown } = loadCountdown(nextShowMarkup());
        const result = StalemateCountdown.apply(document, BEFORE);
        const block = document.querySelector('[data-next-show]');
        const clock = document.querySelector('[data-countdown-clock]');

        expect(result.visibleCount).toBe(1);
        expect(block.hidden).toBe(false);
        expect(clock.hidden).toBe(false);
        expect(document.querySelector('[data-countdown-days]').textContent).toBe('09');
        expect(document.querySelector('[data-countdown-hours]').textContent).toBe('04');
        expect(document.querySelector('[data-countdown-minutes]').textContent).toBe('45');
        expect(document.querySelector('[data-countdown-seconds]').textContent).toBe('00');
        expect(document.querySelector('[data-next-show-block]')).toBeTruthy();
    });

    it('hides the countdown and next-show block after the set with no leftover', () => {
        const { document, StalemateCountdown } = loadCountdown(nextShowMarkup());
        StalemateCountdown.apply(document, BEFORE);
        const result = StalemateCountdown.apply(document, AFTER);
        const block = document.querySelector('[data-next-show]');

        expect(result.visibleCount).toBe(0);
        expect(block.hidden).toBe(true);
        expect(block.textContent).toMatch(/Rockin’ October/);
    });
});
