import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(repoRoot, 'show-state.js'), 'utf8');
const windows = [];

function loadShowState() {
    const dom = new JSDOM(`<!doctype html><html><body>
        <p data-upcoming-empty>No upcoming dates posted yet.</p>
        <div data-upcoming-shows>
            <article data-show data-placeholder="true" id="placeholder-show">
                <a data-show-live-action href="#shows">Get tickets when posted</a>
            </article>
            <article data-show data-starts-at="2026-11-01T19:00:00-05:00" data-ends-at="2026-11-01T22:00:00-05:00" id="dated-show">
                <a data-show-live-action href="https://tickets.example/show">Get tickets</a>
            </article>
        </div>
        <p data-past-empty>No past dates posted yet.</p>
        <div data-past-shows></div>
    </body></html>`, {
        runScripts: 'dangerously',
        url: 'https://rupret007.github.io/StalemateSite/'
    });

    windows.push(dom.window);
    dom.window.eval(source);
    return dom.window;
}

afterEach(() => {
    windows.splice(0).forEach((window) => window.close());
});

describe('dated upcoming and past shows', () => {
    it('fails closed on an invalid clock value', () => {
        const { StalemateShowState } = loadShowState();
        expect(() => StalemateShowState.getPhase({ startsAt: 1 }, Number.NaN)).toThrow(/finite timestamp/);
    });

    it('keeps a placeholder show in upcoming even when the clock moves', () => {
        const { document, StalemateShowState } = loadShowState();
        const result = StalemateShowState.apply(document, Date.parse('2027-01-01T12:00:00-06:00'));

        expect(document.querySelector('#placeholder-show').dataset.showPhase).toBe('upcoming');
        expect(document.querySelector('[data-upcoming-shows]').contains(document.querySelector('#placeholder-show'))).toBe(true);
        expect(document.querySelector('#placeholder-show [data-show-live-action]').hidden).toBe(false);
        expect(result.upcomingCount).toBeGreaterThanOrEqual(1);
    });

    it('moves a dated show to past after it ends and hides ticket actions', () => {
        const { document, StalemateShowState } = loadShowState();

        StalemateShowState.apply(document, Date.parse('2026-10-20T12:00:00-05:00'));
        expect(document.querySelector('#dated-show').dataset.showPhase).toBe('upcoming');
        expect(document.querySelector('#dated-show [data-show-live-action]').hidden).toBe(false);

        StalemateShowState.apply(document, Date.parse('2026-11-01T20:00:00-05:00'));
        expect(document.querySelector('#dated-show').dataset.showPhase).toBe('live');

        StalemateShowState.apply(document, Date.parse('2026-11-01T22:00:00-05:00'));
        expect(document.querySelector('#dated-show').dataset.showPhase).toBe('past');
        expect(document.querySelector('[data-past-shows]').contains(document.querySelector('#dated-show'))).toBe(true);
        expect(document.querySelector('#dated-show [data-show-live-action]').hidden).toBe(true);
        expect(document.querySelector('[data-past-empty]').hidden).toBe(true);
    });
});
