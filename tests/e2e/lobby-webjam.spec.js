// The site relays the app's invitation unchanged. WebJam owns parsing and admission.
const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const jsQR = require('jsqr');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
// Full clipboard format from WebJam build_invite_message and direct_stun_invite.
// This opaque transport fixture is never sent to a WebJam service.
const INVITE = `Join beta rehearsal on WebJam:\nKeep this room open.\nOpen WebJam, choose Join, then paste this full invitation.\nwebjam://join?v=3&r=direct-stun&i=opaque_fixture_only\nwebjam-signal:V0pTRQ${'x'.repeat(3000)}`;

test('two visitors can copy an unchanged app invite, with a fallback when clipboard access fails', async ({ browser, baseURL }) => {
    const contexts = [];
    const relay = hangoutRelayWsBase(baseURL, `webjam-${randomUUID()}`);
    const join = async (nick) => {
        const context = await browser.newContext(); contexts.push(context);
        await context.addInitScript(() => {
            window.copiedInvite = '';
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
                writeText: async (text) => { window.copiedInvite = text; }
            } });
        });
        const page = await context.newPage();
        await page.goto(`/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
        await page.fill('[data-nick]', nick); await page.click('[data-enter]');
        await expect(page.locator('[data-app]')).toBeVisible();
        return page;
    };
    try {
        const host = await join('InviteHost'); const guest = await join('InviteGuest');
        await host.click('[data-start="jam"]');
        await expect(host.locator('[data-jam]')).toBeVisible();
        const channel = await host.evaluate(() => __lobby.active);
        // Jam rooms are invite-only because app invitations contain capabilities.
        await guest.evaluate((channel) => __lobby.cmd('join', [channel]), channel);
        await expect(guest.locator('[data-toast]')).toContainText('invite-only');
        await host.evaluate(() => __lobby.cmd('invite', ['InviteGuest']));
        await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join room', exact: true }).click();
        await expect(guest.locator('[data-jam]')).toBeVisible();
        await expect(guest.locator('[data-jam-copy]')).toBeHidden();
        await host.fill('[data-jam-link]', INVITE); await host.locator('[data-jam-form] button[type="submit"]').click();
        await expect.poll(() => guest.evaluate((expected) => __lobby.chans.get(__lobby.active).jam.invitation === expected, INVITE)).toBe(true);
        await expect(guest.locator('[data-jam-desktop]')).toBeHidden();
        await expect(guest.locator('[data-jam-web]')).toBeDisabled();
        await expect(guest.locator('[data-jam]')).toContainText('Windows and Linux require pasting private invites');
        await guest.click('[data-jam-copy]');
        expect(await guest.evaluate(() => window.copiedInvite)).toBe(INVITE);
        await guest.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard blocked'); }; });
        await guest.click('[data-jam-copy]');
        await expect(guest.locator('[data-jam-copy-value]')).toBeVisible();
        await expect(guest.locator('[data-jam-copy-value]')).toHaveValue(INVITE);
        expect(await guest.locator('[data-jam-copy-value]').evaluate((input) => input.selectionEnd - input.selectionStart)).toBe(INVITE.length);
        expect(await guest.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(INVITE);
        // A guest cannot replace the host's invitation.
        await guest.evaluate(() => __lobby.cmd('jamlink', ['clear']));
        await expect.poll(() => guest.evaluate((expected) => __lobby.chans.get(__lobby.active).jam.invitation === expected, INVITE)).toBe(true);
        await host.evaluate(() => __lobby.cmd('jamlink', ['clear']));
        await expect(guest.locator('[data-jam-copy]')).toBeHidden();
        await expect(guest.locator('[data-jam-copy-value]')).toHaveValue('');
        await expect(guest.locator('[data-jam-desktop]')).not.toHaveAttribute('href');
    } finally { await Promise.all(contexts.map((context) => context.close())); }
});

// Reserved test origin only; opening the destination is intercepted, so this
// proves room handoff and permissions, not Web Join enrollment or music audio.
const WEB_INVITE = 'https://webjam.example/join/#k=synthetic_browser_capability&s=fixture&g=1&e=1800000000';
async function browserRoom(browser, baseURL, configured, viewport) {
    const contexts = [], external = [];
    const relay = hangoutRelayWsBase(baseURL, `${configured ? 'webjam-browser-' : 'webjam-off-'}${randomUUID()}`);
    const join = async (nick, controls = false, via = '') => {
        const context = await browser.newContext({ viewport,
            ...(controls && browser.browserType().name() === 'chromium' ? { permissions: ['local-network-access'] } : {}) }); contexts.push(context);
        await context.route('**/*', route => {
            if (new URL(route.request().url()).origin === new URL(baseURL).origin) return route.continue();
            external.push(route.request().url()); return route.abort();
        });
        if (controls) {
            // Synthetic own-status HTTP only; real consent/identity ordering
            // belongs to the native gateway suite, not this client fixture.
            await context.route(url => url.pathname === '/r/45662413410ed051/lobby/', async route => {
                const response = await route.fetch();
                await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><script src="/beta/bootstrap.js"></script>') });
            });
            await context.route('**/beta/bootstrap.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.HangoutParticipationControls=true;' }));
            await context.route('**/beta/participation', route => route.fulfill({ json: {
                ok: true, state: 'authorized', available: true, purposes: ['public-text', 'camera'], revision: 2, canStop: true
            } }));
            await context.route('**/beta/participation/stop', route => route.fulfill({ status: 503, json: { error: 'Synthetic unconfirmed withdrawal' } }));
        }
        await context.addInitScript(() => {
            window.browserOpens = []; window.audioRequests = 0; window.copiedInvite = '';
            window.open = (...args) => { window.browserOpens.push(args); return null; };
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
                writeText: async text => { window.copiedInvite = text; }
            } });
            if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
                window.audioRequests++; throw Error('Capture is outside this invitation test');
            };
        });
        const page = await context.newPage();
        await page.goto(`/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}${via ? `&via=${via}` : ''}`);
        await page.fill('[data-nick]', nick); await page.click('[data-enter]');
        try { await expect(page.locator('[data-connection]')).toHaveText('Connected'); }
        catch (error) {
            console.log('WEBJAM_JOIN_FIXTURE', await page.evaluate(() => ({
                gate: document.querySelector('[data-gate-status]').textContent,
                sharing: document.querySelector('[data-sharing-status]').textContent,
                socketReadyState: window.__lobby.ws?.readyState
            })));
            throw error;
        }
        return page;
    };
    return { join, external, close: () => Promise.all(contexts.map(context => context.close())) };
}
const paste = async (page, value) => {
    await page.fill('[data-jam-link]', value);
    await page.locator('[data-jam-form] button[type="submit"]').click();
};

for (const [hostSite, guestSite] of [['rad-dad', 'stalemate'], ['stalemate', 'rad-dad']]) {
    test(`${hostSite} can invite someone from ${guestSite} with a single join action`, async ({ browser, baseURL }) => {
        const f = await browserRoom(browser, baseURL, true, { width: 390, height: 844 });
        try {
            const host = await f.join('RoomHost', false, hostSite);
            const guest = await f.join('Bandmate', false, guestSite);
            await host.click('[data-show="rooms"]');
            await host.click('[data-start="jam"]');
            await expect(host.locator('[data-chat-context]')).toHaveText(/^#jam-/);
            const room = await host.locator('[data-chat-context]').textContent();
            const invite = host.getByRole('button', { name: 'Invite bandmate to room' });
            const status = host.locator('[data-room-invite-status]');
            const offer = guest.locator('[data-game-offer]');
            async function send() {
                await invite.click();
                const list = host.getByRole('group', { name: 'Online guests' });
                await list.getByRole('button', { name: 'Invite Bandmate' }).click();
                await expect(status).toHaveText('Invitation sent to Bandmate. Waiting for a reply.');
                await expect(offer).toContainText(`RoomHost invited you to ${room}.`);
            }
            await send();
            await offer.getByRole('button', { name: 'Not now' }).click();
            await expect(status).toHaveText('Bandmate declined the invitation.');
            await send();
            await offer.getByRole('button', { name: 'Join room' }).click();
            await expect(guest.locator('[data-chat-context]')).toHaveText(room);
            await expect(status).toHaveText('Bandmate accepted and joined.');
            await expect(offer).toBeHidden();
            expect(await guest.evaluate(() => [window.copiedInvite, window.browserOpens, window.audioRequests]))
                .toEqual(['', [], 0]);
        } finally { await f.close(); }
    });
}

test('the crowded invite list scrolls on a 375px phone while Cancel stays visible', async ({ browser, baseURL }, testInfo) => {
    const f = await browserRoom(browser, baseURL, true, { width: 375, height: 667 });
    try {
        const host = await f.join('RoomHost', false, 'rad-dad');
        const busy = await f.join('BusyBandmate', false, 'stalemate');
        await busy.click('[data-show="rooms"]');
        await busy.click('[data-start="jam"]');
        await expect(busy.locator('[data-jam]')).toBeVisible();
        for (let i = 1; i <= 11; i++) await f.join(`Bandmate${i}`, false, i % 2 ? 'stalemate' : 'rad-dad');
        await host.click('[data-show="rooms"]');
        await host.click('[data-start="jam"]');
        await host.getByRole('button', { name: 'Invite bandmate to room' }).click();
        const list = host.getByRole('group', { name: 'Online guests' });
        const cancel = host.getByRole('button', { name: 'Cancel', exact: true });
        await expect(list.getByRole('button')).toHaveCount(12);
        await expect(list.getByRole('button', { name: 'Invite BusyBandmate (busy)' })).toHaveText('BusyBandmate · Busy');
        expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
        await expect(cancel).toBeInViewport({ ratio: 1 });
        const file = testInfo.outputPath('invite-roster-375.png');
        await host.screenshot({ path: file, animations: 'disabled' });
        await testInfo.attach('crowded invite roster', { path: file, contentType: 'image/png' });
        await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
        await expect(list.getByRole('button', { name: 'Invite BusyBandmate (busy)' })).toBeInViewport({ ratio: 1 });
        await expect(cancel).toBeInViewport({ ratio: 1 });
        await cancel.click();
        await expect(host.getByRole('dialog', { name: 'Invite a guest' })).toBeHidden();
    } finally { await f.close(); }
});

test('a host can share a browser invite pasted with its surrounding message', async ({ browser, baseURL }) => {
    const f = await browserRoom(browser, baseURL, true, { width: 390, height: 844 });
    try {
        const host = await f.join('PasteHost');
        const guest = await f.join('PasteGuest');
        await host.click('[data-show="rooms"]');
        await host.click('[data-start="jam"]');
        await host.getByRole('button', { name: 'Invite bandmate to room' }).click();
        await host.getByRole('button', { name: 'Invite PasteGuest', exact: true }).click();
        await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join room' }).click();
        await expect(guest.locator('[data-jam-web]')).toBeDisabled();

        const forwarded = `Join me for Music:\n<${WEB_INVITE}>\nSee you there.`;
        await paste(host, forwarded);
        await expect(guest.getByRole('button', { name: 'Join in browser' })).toBeEnabled();
        await expect(host.locator('[data-jam-link]')).toHaveValue('');
        await guest.getByRole('button', { name: 'Join in browser' }).click();
        expect(await guest.evaluate(() => window.browserOpens)).toEqual([[WEB_INVITE, '_blank', 'noopener,noreferrer']]);
        expect(await guest.evaluate(() => window.audioRequests)).toBe(0);

        const other = WEB_INVITE.replace('synthetic_browser_capability', 'other_fixture');
        const ambiguous = `Two invites:\n${WEB_INVITE}\n${other}`;
        await paste(host, ambiguous);
        await expect(host.locator('[data-jam-share-status]')).toHaveText('Paste just one browser invite link.');
        await expect(host.locator('[data-jam-link]')).toHaveValue(ambiguous);
        await expect(host.locator('[data-jam-link]')).toBeFocused();
        await guest.getByRole('button', { name: 'Join in browser' }).click();
        expect(await guest.evaluate(() => window.browserOpens)).toEqual([
            [WEB_INVITE, '_blank', 'noopener,noreferrer'], [WEB_INVITE, '_blank', 'noopener,noreferrer']
        ]);
        expect(f.external).toEqual([]);
    } finally { await f.close(); }
});

test('an expired browser invite is retired in place and a fresh invite restores Join', async ({ browser, baseURL }, testInfo) => {
    const f = await browserRoom(browser, baseURL, true, { width: 390, height: 844 });
    try {
        const host = await f.join('ExpiryHost'), guest = await f.join('ExpiryGuest');
        await host.click('[data-show="rooms"]');
        await host.click('[data-start="jam"]');
        await expect(host.locator('[data-jam]')).toBeVisible();
        await host.evaluate(() => __lobby.cmd('invite', ['ExpiryGuest']));
        await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join room' }).click();
        await expect(guest.locator('[data-jam]')).toBeVisible();
        const room = await guest.locator('[data-chat-context]').textContent();
        const now = Date.now();
        await host.clock.install({ time: now });
        await guest.clock.install({ time: now });
        const expiry = Math.floor(now / 1000) + 60;
        const oldLink = WEB_INVITE.replace(/e=\d+$/, `e=${expiry}`);
        await paste(host, oldLink);
        await expect(guest.locator('[data-jam-web]')).toBeEnabled();
        await guest.getByRole('button', { name: 'Show QR code' }).click();
        await expect(guest.locator('[data-jam-invite-qr-panel]')).toBeVisible();
        await guest.evaluate(() => { navigator.clipboard.writeText = async () => { throw Error('Clipboard blocked'); }; });
        await guest.getByRole('button', { name: 'Copy browser invite' }).click();
        await expect(guest.locator('[data-jam-invite-copy-value]')).toBeFocused();
        await guest.clock.fastForward(61_000);
        await host.clock.fastForward(61_000);
        await expect(guest.locator('[data-jam-web]')).toBeDisabled();
        await expect(guest.locator('[data-jam-web]')).toBeHidden();
        await expect(guest.locator('[data-jam-wait]')).toHaveText('Browser invite expired. Ask your host for a fresh invite here.');
        await expect(guest.locator('[data-jam-wait]')).toBeFocused();
        await expect(guest.locator('[data-jam-invite-qr-panel]')).toBeHidden();
        await expect(guest.locator('[data-jam-invite-copy-value]')).toHaveValue('');
        await expect(guest.locator('[data-chat-context]')).toHaveText(room);
        await expect(guest.locator('[data-connection]')).toHaveText('Connected');
        expect(await guest.evaluate(() => window.browserOpens)).toEqual([]);
        await expect(host.locator('[data-jam-wait]')).toContainText('Copy a fresh browser invite');
        await expect(host.locator('[data-jam-host-steps]')).toBeHidden();
        await expect(host.locator('[data-jam-form] button[type="submit"]')).toBeEnabled();
        await guest.screenshot({ path: testInfo.outputPath('expired-browser-invite-390.png') });

        const freshLink = oldLink.replace('synthetic_browser_capability', 'replacement_fixture')
            .replace(/e=\d+$/, `e=${expiry + 120}`);
        await paste(host, freshLink);
        await expect(guest.getByRole('button', { name: 'Join in browser' })).toBeFocused();
        await guest.screenshot({ path: testInfo.outputPath('fresh-browser-invite-390.png') });
        await guest.getByRole('button', { name: 'Join in browser' }).click();
        expect(await guest.evaluate(() => window.browserOpens)).toEqual([[freshLink, '_blank', 'noopener,noreferrer']]);
        expect(await guest.evaluate(() => window.audioRequests)).toBe(0);
        expect(f.external).toEqual([]);
    } finally { await f.close(); }
});

test('first-invite guidance follows current host power without opening setup help', async ({ browser, baseURL }) => {
    const f = await browserRoom(browser, baseURL, true, { width: 1440, height: 900 });
    try {
        const host = await f.join('SetupHost'), peer = await f.join('SetupPeer');
        await host.click('[data-start="jam"]');
        // Commands target the admitted active channel, not a pending room join.
        await expect(host.locator('[data-jam-host-steps]')).toBeVisible();
        await host.evaluate(() => __lobby.cmd('invite', ['SetupPeer']));
        await peer.locator('[data-game-offer]').getByRole('button', { name: 'Join room', exact: true }).click();
        await expect(host.locator('[data-jam-host-steps]')).toBeInViewport();
        await expect(peer.locator('[data-jam-host-steps]')).toBeHidden();
        await host.evaluate(() => __lobby.cmd('op', ['SetupPeer']));
        await expect(peer.locator('[data-jam-host-steps]')).toBeVisible();
        await peer.evaluate(() => __lobby.cmd('deop', ['SetupHost']));
        await expect(host.locator('[data-jam-host-steps]')).toBeHidden();
        await expect(host.locator('[data-jam-wait]')).toBeVisible();
        await expect(host.locator('[data-jam-form]')).toBeHidden();
        for (const page of [host, peer]) {
            await expect(page.locator('[data-jam-help]')).not.toHaveAttribute('open');
            expect(await page.evaluate(() => window.audioRequests)).toBe(0);
            expect(await page.evaluate(() => window.browserOpens)).toEqual([]);
        }
        expect(f.external).toEqual([]);
    } finally { await f.close(); }
});

for (const width of [375, 390]) test(`host can share desktop and browser invitations through the visible form at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const f = await browserRoom(browser, baseURL, true, { width, height: 844 });
    try {
        const host = await f.join('BrowserHost'), guest = await f.join('BrowserGuest');
        await host.click('[data-show="rooms"]');
        await host.click('[data-start="jam"]');
        await expect(host.locator('[data-jam]')).toBeVisible();
        // First-time hosts get their next steps without opening a help panel.
        await expect(host.locator('[data-jam-help]')).not.toHaveAttribute('open');
        await expect(host.locator('[data-jam-host-steps]')).toBeVisible();
        await expect(host.locator('[data-jam-host-steps]')).toContainText('Music → Host');
        await expect(host.locator('[data-jam-host-steps]')).toContainText('Once your bandmate is in this room, click Copy browser invite in WebJam.');
        await expect(host.getByRole('textbox', { name: 'WebJam invitation' })).toHaveAccessibleDescription(/Copy browser invite[\s\S]*Share with room[\s\S]*Join in browser/);
        await expect(host.getByRole('button', { name: 'Share with room', exact: true })).toBeInViewport();
        await host.screenshot({ path: testInfo.outputPath(`jam-host-before-sharing-${width}.png`), fullPage: true });
        const channel = await host.evaluate(() => __lobby.active);
        await host.evaluate(() => __lobby.cmd('invite', ['BrowserGuest']));
        await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join room', exact: true }).click();
        await expect(guest.locator('[data-jam]')).toBeVisible();
        await expect(guest.locator('[data-jam-web]')).toBeDisabled();
        await expect(guest.locator('[data-jam-form]')).toBeHidden();
        await expect(guest.locator('[data-jam-host-steps]')).toBeHidden();
        await expect(guest.locator('[data-jam-wait]')).toContainText('no app needed');
        await paste(host, INVITE);
        // Each socket confirms independently. A replacement announcement
        // clears an old editor; wait for the host's own confirmation before
        // typing the next invitation, even if the guest received it first.
        await expect(host.locator('[data-jam-copy]')).toBeVisible();
        await expect(host.locator('[data-jam-host-steps]')).toBeHidden();
        await expect(guest.locator('[data-jam-copy]')).toBeVisible();
        await paste(host, ` \n${WEB_INVITE}\n `);
        await expect(host.locator('[data-jam-web]')).toBeEnabled();
        await expect(guest.locator('[data-jam-web]')).toBeEnabled();
        await expect(host.getByRole('button', { name: 'Copy desktop invite', exact: true })).toBeVisible();
        await expect(host.getByRole('button', { name: 'Copy browser invite', exact: true })).toBeVisible();
        await expect(guest.locator('[data-jam-web]')).toHaveAttribute('title', /headphones and audio consent/);
        await expect(guest.locator('[data-jam-wait]')).toBeHidden();
        expect(await guest.evaluate(() => window.browserOpens)).toEqual([]);
        await guest.click('[data-jam-copy]');
        expect(await guest.evaluate(() => window.copiedInvite)).toBe(INVITE);
        // Ordinary room membership cannot overwrite the host's browser link.
        await guest.evaluate(() => __lobby.cmd('jamlink', ['web', 'https://webjam.example/join/#replaced']));
        await expect(guest.locator('[data-toast]')).toContainText(/host|operator|op|@/i);
        await guest.click('[data-jam-web]');
        expect(await guest.evaluate(() => window.browserOpens)).toEqual([[WEB_INVITE, '_blank', 'noopener,noreferrer']]);
        expect(await guest.evaluate(() => __lobby.chans.get(__lobby.active).jam.web)).toBe(WEB_INVITE);
        expect(await guest.evaluate(() => window.audioRequests)).toBe(0);
        expect(await guest.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(WEB_INVITE);
        for (const [role, page] of [['host', host], ['guest', guest]]) {
            await expect(page.locator('[data-jam-help]')).not.toHaveAttribute('open');
            // Platform limits must remain visible without expanding setup help.
            await expect(page.locator('[data-jam-platform]')).toBeVisible();
            await expect(page.locator('[data-jam-platform]')).toContainText('A Mac hosts music');
            await expect(page.locator('[data-jam-platform]')).toContainText('Mac and Windows guests can join in a browser');
            await expect(page.locator('[data-jam-platform]')).toContainText('this unsigned beta cannot join natively');
            expect(await page.locator('#jam-title').evaluate(title => {
                const panel = title.closest('[data-jam]').getBoundingClientRect(), rect = title.getBoundingClientRect();
                return rect.top >= panel.top && rect.bottom <= panel.bottom;
            })).toBe(true);
            await page.screenshot({ path: testInfo.outputPath(`jam-browser-${role}-${width}.png`), fullPage: true });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            expect(await page.locator('[data-text]').evaluate(input => parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16);
        }
        expect(await host.locator('[data-jam-link]').evaluate(input => parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16);
        // Native disclosure remains keyboard-operable on a shorter phone too.
        // Reading help must not open a music page or request capture.
        await guest.setViewportSize({ width, height: 667 });
        const help = guest.locator('[data-jam-help]'), summary = help.locator('summary');
        await summary.focus(); await summary.press('Enter');
        await expect(help).toHaveAttribute('open'); await expect(summary).toBeFocused();
        await expect(help).toContainText('click Copy browser invite. Wait for Link copied, then paste the link above and choose Share with room.');
        await expect(help).toContainText('Sharing an invite does not turn on your microphone');
        await expect(help.locator('p').first()).toBeInViewport({ ratio: 0.5, timeout: 1000 });
        expect(await summary.evaluate(element => {
            const panel = element.closest('[data-jam]').getBoundingClientRect(), rect = element.getBoundingClientRect();
            return rect.top >= panel.top && rect.bottom <= panel.bottom;
        })).toBe(true);
        for (const selector of ['[data-text]', '[data-send]']) expect(await guest.locator(selector).evaluate(element => {
            const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
        })).toBe(true);
        expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await guest.screenshot({ path: testInfo.outputPath(`jam-help-keyboard-${width}.png`), fullPage: true });
        await summary.press('Enter'); await expect(help).not.toHaveAttribute('open');
        await expect(summary).toBeFocused();
        expect(await guest.evaluate(() => window.browserOpens)).toHaveLength(1);
        expect(await guest.evaluate(() => window.audioRequests)).toBe(0);
        await guest.locator('[data-jam-web]').evaluate(button => { window.oldBrowserJoin = button.onclick; });
        await guest.locator('[data-tabs] [role="tab"]').filter({ hasText: '#stalemate' }).click();
        await guest.evaluate(() => window.oldBrowserJoin());
        expect(await guest.evaluate(() => window.browserOpens)).toHaveLength(1);
        await guest.locator('[data-tabs] [role="tab"]').filter({ hasText: channel }).click();
        await host.evaluate(() => __lobby.cmd('jamlink', ['clear']));
        await expect(guest.locator('[data-jam-web]')).toBeDisabled();
        await expect(guest.locator('[data-jam-copy]')).toBeHidden();
        await expect(guest.locator('[data-jam-wait]')).toBeVisible();
        await expect(host.locator('[data-jam-host-steps]')).toBeVisible();
        await expect(guest.locator('[data-jam-host-steps]')).toBeHidden();
        expect(f.external).toEqual([]);
    } finally { await f.close(); }
});

test('browser invitations reject unconfigured origins and let hosts correct rejected pastes', async ({ browser, baseURL }) => {
    for (const configured of [false, true]) {
        const f = await browserRoom(browser, baseURL, configured);
        try {
            const host = await f.join('RejectedHost'); await host.click('[data-start="jam"]');
            const rejected = configured ? 'https://unapproved.example/join/#synthetic' : WEB_INVITE;
            await paste(host, rejected);
            await expect(host.locator('[data-toast]')).toContainText('Browser joining is not configured');
            await expect(host.locator('[data-jam-web]')).toBeDisabled();
            expect(await host.evaluate(() => __lobby.chans.get(__lobby.active).jam.web)).toBe('');
            // A socket send is not confirmation. Retain a rejected paste so
            // the same admitted host can correct it without recovering a lost invite.
            await expect(host.locator('[data-jam-link]')).toHaveValue(rejected);
            if (configured) {
                await paste(host, WEB_INVITE);
                await expect(host.locator('[data-jam-web]')).toBeEnabled();
                await expect(host.locator('[data-jam-link]')).toHaveValue('');
                // Re-sharing the already published link also needs a real
                // room-state confirmation, even when its value is unchanged.
                await paste(host, WEB_INVITE);
                await expect(host.locator('[data-jam-link]')).toHaveValue('');
            }
            expect(await host.evaluate(() => window.browserOpens)).toEqual([]);
            expect(await host.evaluate(() => window.audioRequests)).toBe(0);
            expect(f.external).toEqual([]);
        } finally { await f.close(); }
    }
});

test('a cached browser Join action stays inactive after local Stop when server withdrawal is unconfirmed', async ({ browser, baseURL }) => {
    const f = await browserRoom(browser, baseURL, true);
    try {
        const host = await f.join('StopBrowserHost', true);
        await host.click('[data-start="jam"]'); await expect(host.locator('[data-jam]')).toBeVisible();
        await paste(host, WEB_INVITE); await expect(host.locator('[data-jam-web]')).toBeEnabled();
        await host.locator('[data-jam-web]').evaluate(button => { window.oldBrowserJoin = button.onclick; });
        await host.locator('[data-sharing-controls] summary').click();
        await expect(host.locator('[data-sharing-status]')).toContainText('Sharing is available');
        await host.click('[data-sharing-stop]'); await host.click('[data-sharing-accept]');
        await expect(host.locator('[data-text]')).toBeDisabled();
        await expect(host.locator('[data-sharing-status]')).toContainText('could not be confirmed');
        expect(await host.evaluate(() => __lobby.localMediaPaused)).toBe(true);
        expect(await host.evaluate(() => __lobby.sharingStopped)).not.toBe(true);
        expect(await host.evaluate(() => __lobby.chans.get(__lobby.active).jam)).toBe(null);
        await expect(host.locator('[data-jam-copy-value]')).toHaveValue('');
        await host.evaluate(() => window.oldBrowserJoin());
        expect(await host.evaluate(() => window.browserOpens)).toEqual([]);
        expect(await host.evaluate(() => window.audioRequests)).toBe(0);
        expect(f.external).toEqual([]);
    } finally { await f.close(); }
});

for (const width of [375, 390]) test(`copy invite link and QR encode the shared browser invitation at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const f = await browserRoom(browser, baseURL, true, { width, height: 844 });
    try {
        const host = await f.join('QrHost');
        await host.click('[data-show="rooms"]');
        await host.click('[data-start="jam"]');
        await paste(host, WEB_INVITE);
        await expect(host.locator('[data-jam-invite-copy]')).toBeVisible();
        await host.click('[data-jam-invite-copy]');
        expect(await host.evaluate(() => window.copiedInvite)).toBe(WEB_INVITE);
        expect(WEB_INVITE).not.toMatch(/preview=/);
        await host.click('[data-jam-invite-qr-toggle]');
        const canvas = host.locator('[data-jam-invite-qr]');
        await expect(canvas).toBeVisible();
        await expect.poll(() => canvas.evaluate(node => {
            const rect = node.getBoundingClientRect(), panel = node.closest('[data-jam]').getBoundingClientRect();
            return rect.top >= Math.max(0, panel.top) && rect.bottom <= Math.min(innerHeight, panel.bottom)
                && rect.left >= 0 && rect.right <= innerWidth;
        })).toBe(true);
        for (const selector of ['[data-text]', '[data-send]']) {
            expect(await host.locator(selector).evaluate(node => {
                const rect = node.getBoundingClientRect();
                return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
            })).toBe(true);
        }
        const pixels = await canvas.evaluate(node => {
            const { data, width, height } = node.getContext('2d').getImageData(0, 0, node.width, node.height);
            return { data: Array.from(data), width, height };
        });
        const decoded = jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
        expect(decoded?.data).toBe(WEB_INVITE);
        const modules = 17 + 4 * decoded.version;
        expect(pixels.width % (modules + 8)).toBe(0);
        const quiet = 4 * pixels.width / (modules + 8);
        for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
            if (x >= quiet && y >= quiet && x < pixels.width - quiet && y < pixels.height - quiet) continue;
            expect(pixels.data[(y * pixels.width + x) * 4]).toBeGreaterThan(200);
        }
        await expect(canvas).not.toHaveAttribute('data-invite-url');
        expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await host.screenshot({ path: testInfo.outputPath(`qr-${width}.png`), fullPage: true });
        await host.click('[data-jam-invite-qr-toggle]');
        expect(await canvas.evaluate(node => node.getContext('2d').getImageData(0, 0, node.width, node.height).data.every(value => value === 0))).toBe(true);
        await host.click('[data-jam-invite-qr-toggle]');
        await host.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('blocked'); }; });
        await host.click('[data-jam-invite-copy]');
        await expect(host.locator('[data-jam-invite-copy-value]')).toBeVisible();
        await expect(host.locator('[data-jam-invite-copy-value]')).toHaveValue(WEB_INVITE);
        await host.fill('[data-text]', '/part');
        await host.press('[data-text]', 'Enter');
        await expect(host.locator('[data-jam-invite-qr-panel]')).toBeHidden();
        await expect(canvas).not.toHaveAttribute('data-invite-url');
        expect(await canvas.evaluate(node => node.getContext('2d').getImageData(0, 0, node.width, node.height).data.every(value => value === 0))).toBe(true);
        await expect(host.locator('[data-jam-invite-copy-value]')).toHaveValue('');

    } finally { await f.close(); }
});

test('a bandmate reaches the jam room within three clicks of opening the copied invite link', async ({ browser, baseURL }) => {
    const f = await browserRoom(browser, baseURL, true, { width: 390, height: 844 });
    try {
        const host = await f.join('LinkHost');
        const relay = await host.evaluate(() => sessionStorage.getItem('hangout-relay'));
        const bandmateContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await bandmateContext.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
        await bandmateContext.addInitScript(({ relay }) => {
            sessionStorage.setItem('hangout-preview', 'local-preview-key-0001');
            if (relay) sessionStorage.setItem('hangout-relay', relay);
            window.copiedInvite = '';
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
                writeText: async (text) => { window.copiedInvite = text; }
            } });
            if (sessionStorage.getItem('hangout-count-invite-clicks') === '1') {
                window.__bandmateClicks = 0;
                document.addEventListener('click', () => { window.__bandmateClicks += 1; }, true);
                sessionStorage.removeItem('hangout-count-invite-clicks');
            }
        }, { relay });
        const bandmate = await bandmateContext.newPage();
        await bandmate.goto(`/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
        await bandmate.fill('[data-nick]', 'LinkBandmate');
        await bandmate.click('[data-enter]');
        await expect(bandmate.locator('[data-connection]')).toHaveText('Connected');
        await host.click('[data-show="rooms"]');
        await host.click('[data-start="jam"]');
        await expect(host.locator('[data-jam]')).toBeVisible();
        const channel = await host.locator('[data-chat-context]').textContent();
        await host.fill('[data-text]', '/invite LinkBandmate');
        await host.press('[data-text]', 'Enter');
        await paste(host, WEB_INVITE);
        await expect(host.locator('[data-jam-invite-copy]')).toBeVisible();
        await host.click('[data-jam-invite-copy]');
        const browserInvite = await host.evaluate(() => window.copiedInvite);
        expect(browserInvite).toBe(WEB_INVITE);
        const lobbyEntry = await host.evaluate(({ channel }) => {
            const relay = sessionStorage.getItem('hangout-relay') || '';
            const url = new URL(location.href);
            url.searchParams.delete('preview');
            if (relay) url.searchParams.set('relay', relay);
            url.hash = `room=${encodeURIComponent(channel)}`;
            return url.href;
        }, { channel });
        await bandmateContext.route('https://webjam.example/join/**', route => route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${lobbyEntry.replace(/"/g, '&quot;')}"></head><body></body></html>`
        }));
        await bandmate.evaluate(() => sessionStorage.setItem('hangout-count-invite-clicks', '1'));
        await bandmate.goto(browserInvite, { waitUntil: 'networkidle' });
        if (await bandmate.locator('[data-gate]').isVisible()) {
            await bandmate.fill('[data-nick]', 'LinkBandmate');
            await bandmate.click('[data-enter]');
        }
        await expect(bandmate.locator('[data-connection]')).toHaveText('Connected');
        // The room link and the earlier invitation already admit the bandmate.
        // A repeated invitation must not ask someone in the room to join it.
        await expect(bandmate.locator('[data-jam]')).toBeVisible();
        await expect(bandmate.locator('[data-chat-context]')).toHaveText(channel);
        await host.fill('[data-text]', '/invite LinkBandmate');
        await host.press('[data-text]', 'Enter');
        await expect(host.locator('[data-buffer]')).toContainText(`Invited LinkBandmate to ${channel}.`);
        await expect(bandmate.locator('[data-game-offer]')).toBeHidden();
        await expect(bandmate.locator('[data-toast] button')).toHaveCount(0);
        expect(await bandmate.evaluate(() => window.__bandmateClicks ?? 0)).toBeLessThanOrEqual(3);
        await bandmateContext.close();
    } finally { await f.close(); }
});
