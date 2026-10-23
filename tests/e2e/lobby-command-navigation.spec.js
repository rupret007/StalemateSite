const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

let relay;
test.beforeEach(({ baseURL }) => { relay = hangoutRelayWsBase(baseURL, `join-focus-${randomUUID()}`); });

async function visitor(browser, nick) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
    await page.fill('[data-nick]', nick);
    await page.click('[data-enter]');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    return page;
}

async function type(page, text) {
    await page.fill('[data-text]', text);
    await page.press('[data-text]', 'Enter');
}

test('slash join focuses existing channels without clearing connected history or the destination draft', async ({ browser }) => {
    const page = await visitor(browser, 'CommandGuest');
    try {
        await type(page, 'A message in my connected lobby session');
        await expect(page.locator('[data-buffer]')).toContainText('A message in my connected lobby session');
        await page.fill('[data-text]', 'Unsent lobby draft');
        await page.locator('[data-start="chat"]').click();
        await page.fill('[data-channel-name]', 'command-studio');
        await page.locator('[data-channel-form] button[type="submit"]').click();
        await expect(page.locator('[data-chat-context]')).toHaveText('#command-studio');
        // Keep the ordinary three-second chat slow mode intact.
        await page.waitForTimeout(3500);
        await type(page, 'A message in my connected studio session');
        await expect(page.locator('[data-buffer]')).toContainText('A message in my connected studio session');

        await type(page, '/JOIN #STALEMATE');
        await expect(page.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(page.locator('[data-text]')).toHaveValue('Unsent lobby draft');
        await expect(page.locator('[data-buffer]')).toContainText('A message in my connected lobby session');

        await type(page, '/join #command-studio');
        await expect(page.locator('[data-chat-context]')).toHaveText('#command-studio');
        await expect(page.locator('[data-buffer]')).toContainText('A message in my connected studio session');
        await type(page, '/join #command-studio');
        await expect(page.locator('[data-buffer]')).toContainText('A message in my connected studio session');
    } finally { await page.context().close(); }
});

test('slash join for an unjoined restricted channel still requires server admission', async ({ browser }) => {
    const host = await visitor(browser, 'RestrictedHost');
    const guest = await visitor(browser, 'RestrictedGuest');
    try {
        await type(host, '/join #command-private');
        await expect(host.locator('[data-chat-context]')).toHaveText('#command-private');
        await type(host, '/mode +i');
        await expect.poll(() => host.evaluate(() => window.__lobby.chans.get('#command-private')?.modes.i)).toBe(true);
        await type(guest, '/join #command-private');
        await expect(guest.locator('[data-buffer]')).toContainText('invite-only');
        await expect(guest.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(guest.locator('[data-channel-key="#command-private"]')).toHaveCount(0);
    } finally {
        await host.context().close();
        await guest.context().close();
    }
});
