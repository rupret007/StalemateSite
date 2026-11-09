// Private admission is simulated explicitly; the WebSocket upgrade failure uses
// the real loopback HTTP handler. This does not prove live cookie expiration.
const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
const ROOT = '/r/45662413410ed051/lobby/';

async function contained(page, locator) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await locator.boundingBox(); expect(bounds).not.toBeNull();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
}

for (const { width, status } of [{ width: 375, status: 401 }, { width: 390, status: 401 }, { width: 390, status: 503 }]) {
    test(`a refused initial upgrade shows truthful private-entry recovery for HTTP ${status} at ${width}px`, async ({ browser, baseURL }, testInfo) => {
        const context = await browser.newContext({ viewport: { width, height: 844 } });
        let checks = 0;
        try {
            await context.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
            // A named local private-shell fixture, not a real session cookie.
            // The upgrade is rejected by the actual loopback HTTP handler.
            await context.route('**/beta/bootstrap.js', route => route.fulfill({ contentType: 'text/javascript', body: '// Private-shell marker only.' }));
            await context.route('**/beta/', route => route.fulfill({ contentType: 'text/html', body: '<h1>Your private invitation</h1>' }));
            await context.route('**/beta/state', route => { checks++; return route.fulfill({ status, contentType: 'text/plain', body: status === 401 ? 'Private invitation required.' : 'Temporarily unavailable.' }); });
            await context.route(url => url.pathname === ROOT, async route => {
                const response = await route.fetch();
                await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><script src="/beta/bootstrap.js"></script>') });
            });
            const page = await context.newPage();
            const relay = hangoutRelayWsBase(baseURL, `private-entry-${randomUUID()}`) + '/unavailable';
            await page.goto(`${ROOT}?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
            await page.fill('[data-nick]', 'ReturningGuest'); await page.click('[data-enter]');
            const notice = page.locator('[data-gate-status]');
            const entry = page.getByRole('link', { name: 'Open private entry', exact: true });
            await expect(notice).toHaveText(status === 401
                ? 'Your private access needs renewal. Reopen your invitation link or enter its code.'
                : 'Couldn’t connect. Try again shortly, or ask the host if this continues.');
            await expect(page.locator('[data-nick]')).toHaveValue('ReturningGuest');
            await expect(page.locator('[data-gate]')).toBeVisible();
            if (status === 401) {
                await expect(entry).toBeVisible(); await expect(entry).toHaveAttribute('href', '/beta/');
                await entry.focus(); await expect(entry).toBeFocused(); await contained(page, entry);
                await page.screenshot({ path: testInfo.outputPath(`private-entry-renewal-${width}.png`) });
                await entry.press('Enter'); await expect(page).toHaveURL(baseURL + '/beta/');
                await expect(page.getByRole('heading', { name: 'Your private invitation' })).toBeVisible();
            } else {
                await expect(entry).toBeHidden(); await contained(page, page.locator('[data-enter]'));
                await page.screenshot({ path: testInfo.outputPath('private-entry-outage-390.png') });
            }
            expect(checks).toBe(1);
        } finally { await context.close(); }
    });
}

