import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import { vi } from 'vitest';
import { TurdanoidBrickRace } from '../../play/games/turdanoid-race.js';

const client = vi.hoisted(() => ({ handlers: null }));
vi.mock('../../r/45662413410ed051/lobby/game-night-match-client.mjs', () => ({
    matchConnectionErrors: {},
    createGameNightMatchClient: options => {
        client.handlers = options;
        return { start() {}, stop() {}, send() { return true; } };
    }
}));
const { mountArcadeTurdanoid } = await import('../../r/45662413410ed051/lobby/arcade-turdanoid.mjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'r/45662413410ed051/lobby/lobby.css'), 'utf8');
const mobileStart = css.indexOf('@media (max-width: 900px) and (pointer: coarse)');
const mobile = css.slice(mobileStart, css.indexOf('@media (prefers-reduced-motion: reduce)', mobileStart));

describe('Turdanoid phone layout contract', () => {
    it('renders the back-only race state inside a 390×844 viewport', async () => {
        const view = mountRace();
        const rendered = view.panel.outerHTML;
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><main data-lobby>Game Night lobby</main>${rendered}`);
            await page.evaluate(() => { document.querySelector('[data-lobby]').hidden = true; });
            const button = page.locator('[data-brick-back]');
            expect(await button.isVisible()).toBe(true);
            expect(await page.locator('[data-brick-main], [data-brick-serve]').evaluateAll(elements => elements.every(element => element.hidden))).toBe(true);
            const rect = await button.boundingBox();
            expect(rect).not.toBeNull();
            expect(rect.x).toBeGreaterThanOrEqual(0);
            expect(rect.y).toBeGreaterThanOrEqual(0);
            expect(rect.x + rect.width).toBeLessThanOrEqual(390);
            expect(rect.y + rect.height).toBeLessThanOrEqual(844);
            expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-brick-back]') != null,
                { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })).toBe(true);
            await page.exposeFunction('closeProductionRace', () => {
                view.back.click();
                return { open: view.api.isOpen() };
            });
            await button.evaluate(element => element.addEventListener('click', async () => {
                const result = await window.closeProductionRace();
                document.querySelector('[data-lobby]').hidden = result.open;
            }));
            await button.click();
            expect(view.api.isOpen()).toBe(false);
            expect(await page.locator('[data-lobby]').isVisible()).toBe(true);
        } finally {
            await browser.close();
        }
    }, 30_000);

    it('uses a viewport bounded play surface with visible return and launch controls', () => {
        expect(mobile).toMatch(/\.arcade-brick-race\[open\]:has\(\[data-brick-match\]:not\(\[hidden\]\)\)[\s\S]*?position: fixed;[\s\S]*?inset: 0;[\s\S]*?height: 100dvh;/);
        expect(css).toMatch(/\.brick-race-actions:has\(\[data-brick-back\]:not\(\[hidden\]\)\)\s*\{[^}]*display: flex/);
        expect(mobile).toMatch(/\.brick-race-actions \.btn\s*\{[^}]*min-height: 44px/);
        expect(mobile).toMatch(/\.brick-race-rail \[data-brick-serve\]\s*\{[^}]*grid-column: 1 \/ -1/);
        expect(mobile).toMatch(/\.brick-race-help\s*\{[^}]*position: static/);
    });

    it('bounds the landscape board by viewport height and keeps a score rail beside it', () => {
        const landscape = mobile.slice(mobile.indexOf('@media (max-height: 450px)'));
        expect(landscape).toMatch(/\.brick-race-layout\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) 10rem/);
        expect(landscape).toMatch(/\.brick-race-board\s*\{[^}]*width: min\(calc\(\(100dvh - 180px\) \* 1\.2\), calc\(100dvw - 190px\)\)/);
        const width = Math.min((390 - 180) * 1.2, 844 - 190);
        expect(width / 1.2).toBeLessThanOrEqual(210);
    });
});

function mountRace() {
    document.body.replaceChildren();
    globalThis.matchMedia = window.matchMedia = query => ({ matches: query === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} });
    HTMLCanvasElement.prototype.getContext = () => new Proxy(() => {}, { get: (_target, prop) => prop === 'a' ? 1 : () => {}, set: () => true });
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    const container = document.createElement('div');
    document.body.append(container);
    const api = mountArcadeTurdanoid(container, () => {});
    api.setRoom({ room: '#game-test', ref: 'ref-test', actor: 'actor-test' });
    api.open();
    const race = new TurdanoidBrickRace('race-test', 50_000, null, 1);
    client.handlers.onState({ state: {
        version: 1, game: 'turdanoid', id: 'race-test', seat: null, waiting: false, rematch: null,
        match: race.view('a', 54_000)
    }, canOpen: false });
    return { api, panel: api.panel, back: api.panel.querySelector('[data-brick-back]') };
}
