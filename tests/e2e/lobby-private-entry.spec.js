// Private admission is simulated explicitly; the WebSocket upgrade failure uses
// the real loopback HTTP handler. This does not prove live cookie expiration.
const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
const ROOT = '/r/45662413410ed051/lobby/';

for (const width of [375, 390]) {
    test(`a cold Web Join tab continues to audio check after private admission at ${width}px`, async ({ browser }, testInfo) => {
        const { betaFetch, BetaSessions } = await import('../../hangout-worker/src/beta-entry.mjs');
        const origin = 'https://private-webjam.example.test';
        const code = 'synthetic-beta-entry-test-invitation';
        const values = new Map();
        const storage = {
            get: async key => values.get(key),
            put: async (key, value) => values.set(key, structuredClone(value)),
            list: async ({ prefix, limit }) => new Map([...values].filter(([key]) => key.startsWith(prefix)).slice(0, limit)),
            delete: async keys => { for (const key of [keys].flat()) values.delete(key); },
            setAlarm: async () => {}, deleteAlarm: async () => {}
        };
        storage.transaction = async fn => fn(storage);
        const assets = [];
        const env = {
            HANGOUT_BETA_MODE: 'protected',
            HANGOUT_BETA_INVITE_KEY: code,
            HANGOUT_HMAC_KEY: 'synthetic-beta-entry-test-signature-key',
            HANGOUT_PREVIEW_KEY: 'synthetic-beta-entry-test-preview',
            LOBBY: {}, QUOTA: {}, ROOMS: {},
            ASSETS: { fetch: async request => {
                const pathname = new URL(request.url).pathname;
                if (pathname === '/r/45662413410ed051/entry-sites.mjs') {
                    return new Response(await readFile(path.join(__dirname, '../..', pathname.slice(1))), { headers: { 'Content-Type': 'text/javascript' } });
                }
                const filename = pathname === '/join/' ? 'index.html' : pathname.split('/').at(-1);
                if (!/^\/join\/(?:[a-z-]+\.(?:js|css|html))?$/.test(pathname)) return new Response(null, { status: 404 });
                assets.push(pathname);
                const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(filename)];
                return new Response(await readFile(path.join(__dirname, '../../join', filename)), { headers: { 'Content-Type': contentType } });
            } }
        };
        const registry = new BetaSessions({ storage, blockConcurrencyWhile: fn => fn() }, env);
        env.BETA_SESSIONS = { idFromName: name => name, get: () => registry };
        const context = await browser.newContext({ viewport: { width, height: 667 } });
        const network = [], external = [];
        try {
            await context.addInitScript(() => {
                window.captureCalls = 0;
                navigator.mediaDevices.getUserMedia = async () => { window.captureCalls++; throw new Error('Unexpected capture'); };
            });
            await context.route('**/*', async route => {
                const request = route.request(), url = new URL(request.url());
                if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
                network.push(url.pathname + url.search + url.hash);
                const headers = new Headers(await request.allHeaders());
                // WebKit's intercepted requests can omit the HttpOnly cookie
                // that is already present in this isolated browser context.
                if (!headers.has('Cookie')) {
                    const cookies = await context.cookies(url.href);
                    if (cookies.length) headers.set('Cookie', cookies.map(({ name, value }) => `${name}=${value}`).join('; '));
                }
                const result = await betaFetch(new Request(request.url(), {
                    method: request.method(), headers, body: request.postData() ?? undefined
                }), env);
                await route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers), body: Buffer.from(await result.arrayBuffer()) });
            });
            const invite = `${origin}/join/#k=${Buffer.alloc(32, 17).toString('base64url')}&s=${'22'.repeat(32)}&g=1&e=${Math.floor(Date.now() / 1000) + 480}`;
            const page = await context.newPage();
            expect((await page.goto(invite)).status()).toBe(401);
            await expect(page.getByText('Hang Out community code', { exact: true })).toBeVisible();
            const proceed = page.getByRole('button', { name: 'Continue to WebJam', exact: true });
            await expect(proceed).toBeVisible();
            await contained(page, proceed);
            await page.screenshot({ path: testInfo.outputPath(`web-join-private-entry-${width}.png`) });
            await proceed.focus();
            const earlyReload = page.waitForResponse(response => new URL(response.url()).pathname === '/join/');
            await proceed.press('Enter');
            expect((await earlyReload).status()).toBe(401);
            await expect(page).toHaveURL(invite);
            expect(assets).toEqual([]);
            const opened = context.waitForEvent('page');
            await page.getByRole('link', { name: 'Open Hang Out in a new tab' }).click();
            const entry = await opened;
            await expect(entry).toHaveURL(origin + '/beta/');
            expect(await entry.evaluate(() => window.opener)).toBeNull();
            await entry.getByLabel('Invitation code').fill(code);
            const accepted = entry.waitForResponse(response => new URL(response.url()).pathname === '/beta/unlock');
            await entry.getByRole('button', { name: 'Enter the community' }).click();
            expect((await accepted).status()).toBe(200);
            await expect.poll(async () => (await context.cookies(origin)).some(cookie => cookie.name === '__Host-hangout-beta')).toBe(true);
            await expect(entry.getByRole('heading', { name: 'You’re on the guest list.' })).toBeVisible();
            await entry.close();
            await proceed.focus();
            const admittedReload = page.waitForResponse(response => new URL(response.url()).pathname === '/join/');
            await proceed.press('Enter');
            expect((await admittedReload).status()).toBe(200);
            await expect(page).toHaveURL(invite);
            await expect(page.getByRole('heading', { name: 'Check your audio' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Join with microphone' })).toBeDisabled();
            expect(await page.evaluate(() => window.captureCalls)).toBe(0);
            expect(network.filter(url => url === '/join/')).toHaveLength(3);
            expect(network.every(url => !url.includes('#'))).toBe(true);
            expect(external).toEqual([]);
        } finally { await context.close(); }
    });
}

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
    const offers = [];
    const engine = createLobby({ send: (_id, frame) => active.send(JSON.stringify(frame.t === 'hello'
        ? { ...frame, deviceToken: 'inline-synthetic-device' } : frame)) });
    await page.routeWebSocket(url => url.pathname.endsWith('/lobby'), socket => {
        attempts++;
        const params = new URL(socket.url()).searchParams;
        offers.push([params.get('device-in-hello'), params.get('dev')]);
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
    await expect.poll(() => page.evaluate(() => localStorage.getItem('hangout-dev'))).toBe('inline-synthetic-device');
    expect(offers).toEqual([['1', null], ['1', 'synthetic-device']]);
    await page.clock.runFor(20_001);
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    expect(attempts).toBe(2);
});
