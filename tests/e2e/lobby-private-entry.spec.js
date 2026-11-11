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

test('an open connection without a welcome times out and the guest can retry', async ({ page, baseURL }) => {
    const { createLobby } = await import('../../hangout-worker/src/lobby-core.mjs');
    await page.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
    let attempts = 0, staleClosed = false, active;
    const engine = createLobby({ send: (_id, frame) => active.send(JSON.stringify(frame)) });
    await page.routeWebSocket(url => url.pathname.endsWith('/lobby'), socket => {
        attempts++;
        if (attempts === 1) {
            socket.onClose(() => { staleClosed = true; });
            socket.send(JSON.stringify({ t: 'device', token: 'synthetic-device' }));
            return;
        }
        active = socket;
        socket.onMessage(raw => void engine.message('timeout-retry', String(raw)));
        socket.onClose(() => void engine.disconnect('timeout-retry'));
        engine.connect({ id: 'timeout-retry', dev: 'device-retry', iph: 'ip-retry', role: 'fan', account: '', admin: false });
    });
    await page.clock.install();
    const relay = hangoutRelayWsBase(baseURL, 'join-timeout');
    await page.goto(`${ROOT}?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
    await page.fill('[data-nick]', 'RetryGuest');
    await page.click('[data-enter]');
    await expect.poll(() => attempts).toBe(1);
    await expect(page.locator('[data-connection]')).toHaveText('Connecting…');
    await expect(page.locator('[data-enter]')).toBeDisabled();
    await page.clock.runFor(20_001);

    await expect(page.locator('[data-connection]')).toHaveText('Offline');
    await expect(page.locator('[data-gate-status]')).toHaveText('Hang Out took too long to respond. Try again.');
    await expect(page.locator('[data-nick]')).toHaveValue('RetryGuest');
    await expect(page.locator('[data-enter]')).toBeEnabled();
    await expect.poll(() => staleClosed).toBe(true);
    expect(attempts).toBe(1);

    await page.locator('[data-enter]').press('Enter');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    await page.clock.runFor(20_001);
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    expect(attempts).toBe(2);
});
