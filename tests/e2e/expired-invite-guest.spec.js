const { readFileSync } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');

const GUEST_PATH = '/beta/game-night/guest';
const INVITATION_PATH = '/beta/game-night/invitation/details';
const LOBBY_ROOT = '/r/45662413410ed051/lobby/';
const PHONE = { width: 390, height: 844 };
const guestModule = readFileSync(path.join(__dirname, '../../r/45662413410ed051/lobby/game-night-guest.js'), 'utf8');
const gameNightModule = readFileSync(path.join(__dirname, '../../r/45662413410ed051/lobby/game-night.mjs'), 'utf8');
const audioModule = readFileSync(path.join(__dirname, '../../r/45662413410ed051/lobby/game-night-audio.mjs'), 'utf8');
const unavailable = 'This invite is no longer available. Ask your host for a new one.';
const freshLink = 'Ask the host for a fresh link.';

for (const shareAvailable of [true, false]) {
    test(`an expired Game Night invite gives a usable host message (${shareAvailable ? 'share fallback' : 'clipboard only'})`, async ({ browser, baseURL }) => {
        const code = randomUUID().replaceAll('-', '');
        const context = await browser.newContext({ viewport: PHONE, hasTouch: true });
        const page = await context.newPage();
        const pageErrors = [];
        const origin = new URL(baseURL).origin;
        try {
            await context.route('**/*', route => new URL(route.request().url()).origin === origin
                ? route.continue() : route.abort());
            await context.route(url => url.pathname === GUEST_PATH, route => route.fulfill({
                contentType: 'text/html',
                body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Game Night invitation</title><script type="module" src="${GUEST_PATH}.js"></script></head><body><main class="game-invitation"><p class="eyebrow">PRIVATE GAME NIGHT</p><h1 data-guest-game>Game Night</h1><p class="lede" data-guest-inviter hidden></p><p id="guest-invitation-status" data-guest-status role="status">Checking your invitation…</p><section data-guest-invite aria-label="Accept the invitation" hidden><p id="guest-agreement">By joining, you confirm you’re 13+ and agree to the house rules.</p><button type="button" aria-describedby="guest-agreement" data-guest-join>Join game</button></section><button type="button" data-guest-retry hidden>Try again</button><button type="button" data-guest-fresh hidden>Ask the host for a fresh link.</button></main></body></html>`
            }));
            await context.route(url => url.pathname === `${GUEST_PATH}.js`, route => route.fulfill({
                contentType: 'text/javascript', body: guestModule
            }));
            await context.route(url => url.pathname === `${LOBBY_ROOT}game-night.mjs`, route => route.fulfill({
                contentType: 'text/javascript', body: gameNightModule
            }));
            await context.route(url => url.pathname === `${LOBBY_ROOT}game-night-audio.mjs`, route => route.fulfill({
                contentType: 'text/javascript', body: audioModule
            }));
            await context.route(url => url.pathname === INVITATION_PATH, route => route.fulfill({
                status: 410,
                contentType: 'application/json',
                body: JSON.stringify({ error: unavailable })
            }));
            await context.addInitScript(({ shareAvailable }) => {
                window.sharedMessages = [];
                window.copiedMessages = [];
                if (shareAvailable) Object.defineProperty(navigator, 'share', { configurable: true, value: async payload => {
                    window.sharedMessages.push(payload);
                    throw new DOMException('Sharing is unavailable in this browser.', 'NotAllowedError');
                }});
                else Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
                Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
                    writeText: async text => { window.copiedMessages.push(text); }
                }});
            }, { shareAvailable });
            page.on('pageerror', error => pageErrors.push(error.message));
            await page.goto(`${baseURL}${GUEST_PATH}#invite=${code}`);

            const fresh = page.getByRole('button', { name: freshLink, exact: true });
            await expect(fresh).toBeVisible();
            await expect(page.getByRole('button', { name: 'Join game' })).toBeHidden();
            await expect(page.getByRole('button', { name: 'Try again' })).toBeHidden();
            await expect(page.getByRole('status')).toHaveText(unavailable);
            const bounds = await fresh.boundingBox();
            expect(bounds).not.toBeNull();
            expect(bounds.height).toBeGreaterThanOrEqual(44);
            expect(bounds.width).toBeGreaterThanOrEqual(44);
            expect(bounds.x).toBeGreaterThanOrEqual(0);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(PHONE.width);
            expect(bounds.y).toBeLessThan(PHONE.height);
            expect(await page.evaluate(() => document.scrollingElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);

            await fresh.tap();
            const shared = await page.evaluate(() => window.sharedMessages);
            expect(shared).toHaveLength(shareAvailable ? 1 : 0);
            if (shareAvailable) {
                expect(shared[0].text).toBe(freshLink);
                expect(JSON.stringify(shared[0])).not.toContain(code);
            }
            await expect.poll(() => page.evaluate(() => window.copiedMessages)).toEqual([freshLink]);
            await expect(page.getByRole('button', { name: 'Copied. Send it to your host.', exact: true })).toBeVisible();

            const dom = await page.locator('body').evaluate(element => ({ html: element.innerHTML, text: element.innerText }));
            expect(dom.html).not.toContain(code);
            expect(dom.text).not.toContain(code);
            expect(dom.text).not.toMatch(/\{\s*"error"\s*:/);
            expect(dom.text).toContain(unavailable);
            expect(pageErrors).toEqual([]);
        } finally {
            await context.close();
        }
    });
}
