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
