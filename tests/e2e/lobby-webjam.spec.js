// The site relays the app's invitation unchanged. WebJam owns parsing and admission.
const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
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
        await guest.locator('[data-toast]').getByRole('button', { name: 'Join', exact: true }).click();
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
    const join = async nick => {
        const context = await browser.newContext({ viewport }); contexts.push(context);
        await context.route('**/*', route => {
            if (new URL(route.request().url()).origin === new URL(baseURL).origin) return route.continue();
            external.push(route.request().url()); return route.abort();
        });
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
        await page.goto(`/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
        await page.fill('[data-nick]', nick); await page.click('[data-enter]');
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
        return page;
    };
    return { join, external, close: () => Promise.all(contexts.map(context => context.close())) };
}
const paste = async (page, value) => {
    await page.fill('[data-jam-link]', value);
    await page.locator('[data-jam-form] button[type="submit"]').click();
};

for (const width of [375, 390]) test(`host can share desktop and browser invitations through the visible form at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const f = await browserRoom(browser, baseURL, true, { width, height: 844 });
    try {
        const host = await f.join('BrowserHost'), guest = await f.join('BrowserGuest');
        await host.click('[data-show="rooms"]');
        await host.click('[data-start="jam"]');
        await expect(host.locator('[data-jam]')).toBeVisible();
        const channel = await host.evaluate(() => __lobby.active);
        await host.evaluate(() => __lobby.cmd('invite', ['BrowserGuest']));
        await guest.locator('[data-toast]').getByRole('button', { name: 'Join', exact: true }).click();
        await expect(guest.locator('[data-jam]')).toBeVisible();
        await expect(guest.locator('[data-jam-web]')).toBeDisabled();
        await expect(guest.locator('[data-jam-form]')).toBeHidden();
        await paste(host, INVITE);
        // Each socket confirms independently. A replacement announcement
        // clears an old editor; wait for the host's own confirmation before
        // typing the next invitation, even if the guest received it first.
        await expect(host.locator('[data-jam-copy]')).toBeVisible();
        await expect(guest.locator('[data-jam-copy]')).toBeVisible();
        await paste(host, ` \n${WEB_INVITE}\n `);
        await expect(host.locator('[data-jam-web]')).toBeEnabled();
        await expect(guest.locator('[data-jam-web]')).toBeEnabled();
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
            await page.screenshot({ path: testInfo.outputPath(`jam-browser-${role}-${width}.png`), fullPage: true });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
        await guest.locator('[data-jam-web]').evaluate(button => { window.oldBrowserJoin = button.onclick; });
        await guest.locator('[data-tabs] [role="tab"]').filter({ hasText: '#stalemate' }).click();
        await guest.evaluate(() => window.oldBrowserJoin());
        expect(await guest.evaluate(() => window.browserOpens)).toHaveLength(1);
        await guest.locator('[data-tabs] [role="tab"]').filter({ hasText: channel }).click();
        await host.evaluate(() => __lobby.cmd('jamlink', ['clear']));
        await expect(guest.locator('[data-jam-web]')).toBeDisabled();
        await expect(guest.locator('[data-jam-copy]')).toBeHidden();
        await expect(guest.locator('[data-jam-wait]')).toBeVisible();
        expect(f.external).toEqual([]);
    } finally { await f.close(); }
});

test('browser invitations remain unavailable without an exact configured origin', async ({ browser, baseURL }) => {
    for (const configured of [false, true]) {
        const f = await browserRoom(browser, baseURL, configured);
        try {
            const host = await f.join('RejectedHost'); await host.click('[data-start="jam"]');
            await paste(host, configured ? 'https://unapproved.example/join/#synthetic' : WEB_INVITE);
            await expect(host.locator('[data-toast]')).toContainText('Browser joining is not configured');
            await expect(host.locator('[data-jam-web]')).toBeDisabled();
            expect(await host.evaluate(() => __lobby.chans.get(__lobby.active).jam.web)).toBe('');
            expect(await host.evaluate(() => window.browserOpens)).toEqual([]);
            expect(await host.evaluate(() => window.audioRequests)).toBe(0);
            expect(f.external).toEqual([]);
        } finally { await f.close(); }
    }
});
