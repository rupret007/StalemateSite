const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');

const GUEST_PATH = '/beta/game-night/guest';
const INVITATION_PATH = '/beta/game-night/invitation/details';
const LOBBY_ASSET = '/r/45662413410ed051/lobby/game-night-guest.js';
const PHONE = { width: 390, height: 844 };

test('an expired Game Night invite gives a guest a usable host message', async ({ browser, baseURL }) => {
    const code = randomUUID().replaceAll('-', '');
    const context = await browser.newContext({ viewport: PHONE, hasTouch: true });
    const pageErrors = [];
    try {
        await context.route('**/*', route => new URL(route.request().url()).origin === baseURL
            ? route.continue() : route.abort());
        await context.route(url => url.pathname === GUEST_PATH, route => route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Game Night invitation</title><script type="module" src="${GUEST_PATH}.js"></script></head><body><main class="game-invitation"><p class="eyebrow">PRIVATE GAME NIGHT</p><h1 data-guest-game>Game Night</h1><p class="lede" data-guest-inviter hidden></p><p id="guest-invitation-status" data-guest-status role="status">Checking your invitation…</p><section data-guest-invite aria-label="Accept the invitation" hidden><p id="guest-agreement">By joining, you confirm you’re 13+ and agree to the house rules.</p><button type="button" aria-describedby="guest-agreement" data-guest-join>Join game</button></section><button type="button" data-guest-retry hidden>Try again</button><button type="button" data-guest-fresh hidden>Ask the host for a fresh link</button></main></body></html>`
        }));
        await context.route(url => url.pathname === `${GUEST_PATH}.js`, async route => {
            const response = await route.fetch({ url: new URL(LOBBY_ASSET, baseURL).href });
            await route.fulfill({ response });
        });
        await context.route(url => url.pathname === INVITATION_PATH, route => route.fulfill({
            status: 410,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'This Game Night invitation is unavailable.' })
        }));
        await context.addInitScript(() => {
            window.sharedMessages = [];
            window.copiedMessages = [];
            Object.defineProperty(navigator, 'share', { configurable: true, value: async payload => {
                window.sharedMessages.push(payload);
                throw new DOMException('Sharing is unavailable in this browser.', 'NotAllowedError');
            }});
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
                writeText: async text => { window.copiedMessages.push(text); }
            }});
        });
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(`${baseURL}${GUEST_PATH}#invite=${code}`);

        const fresh = page.getByRole('button', { name: 'Ask the host for a fresh link', exact: true });
        await expect(fresh).toBeVisible();
        const bounds = await fresh.boundingBox();
        expect(bounds && bounds.height).toBeGreaterThanOrEqual(44);
        await fresh.tap();
        const shared = await page.evaluate(() => window.sharedMessages);
        expect(shared).toHaveLength(1);
        expect(shared[0].text).toContain('Ask the host for a fresh link.');
        expect(shared[0].text).not.toContain(code);
        await expect.poll(() => page.evaluate(() => window.copiedMessages)).toEqual(['Ask the host for a fresh link.']);
        await expect(page.getByRole('button', { name: 'Copied. Send it to your host.', exact: true })).toBeVisible();

        const visibleText = await page.locator('body').innerText();
        expect(visibleText.trim().length).toBeGreaterThan(0);
        expect(visibleText).not.toMatch(/\{\s*"error"\s*:/);
        expect(visibleText).toContain('This Game Night invitation is unavailable.');
        expect(pageErrors).toEqual([]);
    } finally {
        await context.close();
    }
});
