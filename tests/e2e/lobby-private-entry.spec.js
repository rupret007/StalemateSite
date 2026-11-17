// Private admission is simulated explicitly; the WebSocket upgrade failure uses
// the real loopback HTTP handler. This does not prove live cookie expiration.
const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
const ROOT = '/r/45662413410ed051/lobby/';

for (const width of [390, 1440]) test(`protected newcomer reaches a shared room and leaves safely at ${width}px`, async ({ browser }, testInfo) => {
    const { privateCommunity } = await import('./helpers/private-community.mjs');
    const community = await privateCommunity(), contexts = [], pageErrors = [];
    const otherWidth = width === 390 ? 1440 : 390;
    async function entry(viewWidth, source) {
        const context = await browser.newContext({ ignoreHTTPSErrors: true,
            viewport: { width: viewWidth, height: viewWidth === 390 ? 844 : 900 },
            hasTouch: viewWidth === 390, reducedMotion: 'reduce' });
        contexts.push(context);
        await context.route('**/*', route => new URL(route.request().url()).origin === community.origin ? route.continue() : route.abort());
        await context.addInitScript(() => {
            window.fixtureCaptureCalls = 0;
            if (!navigator.mediaDevices) return; // Initial blank tabs have no media API.
            for (const name of ['getUserMedia', 'getDisplayMedia']) {
                Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), name, {
                    configurable: true, value: async () => { window.fixtureCaptureCalls++; throw new Error('This newcomer walkthrough never captures media'); }
                });
            }
        });
        const page = await context.newPage();
        page.on('pageerror', error => pageErrors.push(error.name));
        const entryUrl = community.origin + '/beta/?via=' + source;
        return { page, context, entryUrl, source };
    }
    async function admit(visitor) {
        const { page, context, entryUrl } = visitor;
        await page.goto(entryUrl + '#invite=' + community.invitation);
        const proceed = page.getByRole('link', { name: /Choose a nickname and join/ });
        await expect(proceed).toBeVisible();
        await expect(page.getByLabel('Invitation code')).toBeHidden();
        expect(new URL(page.url()).hash).toBe('');
        expect(await page.evaluate(invite => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(invite), community.invitation)).toBe(false);
        const cookie = (await context.cookies()).find(cookie => cookie.name === community.sessionCookieName);
        // Assert the application's existing betaCookie policy exactly.
        expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' });
        await proceed.press('Enter');
        await expect(page.locator('[data-entry-label]').first()).toHaveText('via ' + (visitor.source === 'rad-dad' ? 'Rad Dad' : 'Stalemate'));
        expect(await page.evaluate(() => typeof navigator.mediaDevices?.getUserMedia === 'function')).toBe(true);
    }
    async function nick(page, name) {
        const input = page.getByRole('textbox', { name: 'Your nick', exact: true });
        await input.press('ControlOrMeta+A'); await input.press('Backspace'); await input.pressSequentially(name);
        await page.locator('[data-enter]').press('Enter');
    }
    async function send(page, message) {
        const input = page.getByRole('textbox', { name: 'Message', exact: true });
        await input.pressSequentially(message); await input.press('Enter');
    }
    async function show(page, section) {
        const navigation = page.locator(`nav [data-show="${section}"]`);
        if (await navigation.isVisible()) await navigation.click();
    }
    const capture = (page, name) => page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`) });
    try {
        const host = await entry(otherWidth, width === 390 ? 'stalemate' : 'rad-dad');
        await admit(host); await nick(host.page, 'StudioHost');
        await expect(host.page.locator('[data-connection]')).toHaveText('Connected');
        await send(host.page, 'Earlier conversation stays in its connected session.');
        const guest = await entry(width, width === 390 ? 'rad-dad' : 'stalemate');
        expect((await guest.context.request.get(community.origin + ROOT)).status()).toBe(401);
        expect((await guest.context.request.get(community.origin + ROOT + 'lobby.js')).status()).toBe(401);
        await guest.page.goto(guest.entryUrl + '#invite=rejected-fixture-only');
        await expect(guest.page.locator('#status')).toHaveText('This invitation didn’t work. Check the link or code, or ask your host for a new invitation.');
        await expect(guest.page.getByRole('link', { name: /Choose a nickname and join/ })).toBeHidden();
        expect(new URL(guest.page.url()).hash).toBe('');
        await capture(guest.page, '01-rejected-private-entry');
        await admit(guest);
        await nick(guest.page, 'StudioHost');
        const name = guest.page.getByRole('textbox', { name: 'Your nick', exact: true });
        await expect(name).toBeFocused();
        await expect(name).toHaveAccessibleDescription('That nick is taken right now.');
        await capture(guest.page, '02-nickname-conflict');
        await nick(guest.page, 'StudioGuest');
        await expect(guest.page.locator('[data-connection]')).toHaveText('Connected');
        await expect(guest.page.getByRole('region', { name: 'Chat', exact: true })).toBeFocused();
        const log = guest.page.getByRole('log', { name: 'Conversation' });
        await expect(log).not.toContainText('Earlier conversation stays in its connected session.');
        await send(guest.page, 'Hello from the other band entrance.');
        await expect(host.page.getByRole('log', { name: 'Conversation' })).toContainText('Hello from the other band entrance.');
        await capture(guest.page, '03-shared-lobby-chat');

        await show(host.page, 'rooms'); await host.page.locator('[data-start="chat"]').click();
        const channel = host.page.getByRole('dialog', { name: 'Your own #channel', exact: true });
        await channel.getByRole('textbox', { name: 'Channel name', exact: true }).pressSequentially('#studio-chat');
        await channel.getByRole('button', { name: 'Join / create', exact: true }).press('Enter');
        await expect(channel).toBeHidden();
        await expect(host.page.locator('[data-chat-context]')).toHaveText('#studio-chat');
        await show(guest.page, 'rooms');
        await guest.page.getByRole('searchbox', { name: 'Find a room' }).pressSequentially('studio-chat');
        await expect(guest.page.locator('[data-roomlist] button[data-room="#studio-chat"]')).toBeVisible();
        await capture(guest.page, '04-room-discovered');
        await host.page.locator('[data-roomtools]').press('Enter');
        await host.page.getByRole('dialog', { name: 'Commands', exact: true }).getByRole('button', { name: 'Invite guest', exact: true }).press('Enter');
        const invite = host.page.getByRole('dialog', { name: 'Invite a guest', exact: true });
        const roster = invite.getByRole('combobox', { name: 'Online guests', exact: true });
        await expect(roster).toBeVisible(); await expect(roster).toBeFocused();
        await roster.selectOption({ label: 'StudioGuest' });
        await invite.getByRole('button', { name: 'Invite selected person', exact: true }).press('Enter');
        await expect(invite).toBeHidden();
        const offer = guest.page.locator('[data-room-invite]');
        const join = offer.getByRole('button', { name: 'Join', exact: true });
        await expect(join).toBeInViewport({ ratio: 1 });
        await capture(guest.page, '05-room-invitation');
        await join.press('Enter');
        await expect(guest.page.locator('[data-chat-context]')).toHaveText('#studio-chat');
        await expect(guest.page.getByRole('tab', { name: '#studio-chat', exact: true })).toBeFocused();
        await send(guest.page, 'We are together in the invited room.');
        await expect(host.page.getByRole('log', { name: 'Conversation' })).toContainText('We are together in the invited room.');
        const input = guest.page.getByRole('textbox', { name: 'Message', exact: true });
        await expect(input).toBeInViewport({ ratio: 1 });
        await expect(guest.page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({ ratio: 1 });
        expect(await guest.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await capture(guest.page, '06-invited-room-first-message');
        await guest.page.locator('[data-roombar]').getByRole('button', { name: 'Leave', exact: true }).press('Enter');
        await expect(guest.page.locator('[data-chat-context]')).toHaveText('#stalemate');
        await send(guest.page, 'Back in the lobby after leaving.');
        await capture(guest.page, '07-left-room');
        const access = await guest.context.newPage();
        await access.goto(guest.entryUrl);
        await access.getByRole('button', { name: 'Leave this beta', exact: true }).press('Enter');
        await expect(access.getByRole('heading', { name: 'Your private invitation', exact: true })).toBeVisible();
        expect((await guest.context.request.get(community.origin + ROOT + 'lobby.js')).status()).toBe(401);
        for (const visitor of [host, guest]) expect(await visitor.page.evaluate(() => window.fixtureCaptureCalls)).toBe(0);
        expect(community.diagnostics().admittedUpgrades).toBeGreaterThanOrEqual(2);
        expect(community.diagnostics().failures).toEqual([]); expect(pageErrors).toEqual([]);
        await testInfo.attach('protected-newcomer-scope', { contentType: 'application/json', body: JSON.stringify(community.diagnostics()) });
    } finally {
        const closed = await Promise.allSettled(contexts.map(context => context.close()));
        await community.close();
        const failures = closed.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, 'Owned newcomer contexts did not close cleanly');
    }
});

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
