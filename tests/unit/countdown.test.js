import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

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
