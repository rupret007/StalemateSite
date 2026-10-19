const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium community flows');
let relay;
test.beforeEach(({ baseURL }) => { relay = hangoutRelayWsBase(baseURL, `community-${randomUUID()}`); });
const url = (owner = false) => `/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}${owner ? '&owner=1' : ''}`;
async function visitor(browser, nick, account, viewport) {
    const ctx = await browser.newContext({ viewport }); const page = await ctx.newPage();
    if (account) await page.addInitScript((identity) => {
        const NativeSocket = window.WebSocket;
        window.WebSocket = class extends NativeSocket {
            constructor(address, protocols) {
                const u = new URL(address);
                if (u.pathname.endsWith('/lobby-owner')) { u.searchParams.set('devowner', 'local-dev-admin-key-0001'); u.searchParams.set('account', identity); }
                super(u.href, protocols);
            }
        };
    }, account);
    await page.goto(url(!!account)); await page.fill('[data-nick]', nick); await page.click('[data-enter]');
    await expect(page.locator('[data-app]')).toBeVisible(); return page;
}
async function create(page) {
    await page.evaluate(() => window.__lobby.cmd('join', ['#night-owls']));
    await expect(page.locator('[data-chat-context]')).toHaveText('#night-owls');
    await page.click('[data-roomtools]'); await page.getByRole('button', { name: 'Keep this room', exact: true }).click();
    await expect(page.locator('[data-host-status]')).toContainText('Registered');
}
test('email-backed room ownership returns on another device with fresh chat and searchable registration', async ({ browser }) => {
    const owner = await visitor(browser, 'FirstOwner', 'owner@example.test');
    await create(owner);
    await owner.fill('[data-text]', 'Only this connected session sees these words'); await owner.press('[data-text]', 'Enter');
    await expect(owner.locator('[data-buffer]')).toContainText('Only this connected session');
    await owner.context().close();
    const back = await visitor(browser, 'ReturnedOwner', 'owner@example.test');
    await back.selectOption('[data-room-filter]', 'mine'); await back.fill('[data-room-search]', 'night');
    await back.locator('[data-room="#night-owls"]').click();
    await expect(back.locator('[data-roomtools]')).toBeVisible();
    await expect(back.locator('[data-buffer]')).not.toContainText('Only this connected session');
    await expect(back.locator('[data-cam]')).toBeHidden();
    await back.context().close();
});
test('phone owner can revoke an offline verified co-host using visible host controls', async ({ browser }) => {
    const owner = await visitor(browser, 'PhoneOwner', 'owner@example.test', { width: 390, height: 844 });
    await create(owner);
    const friend = await visitor(browser, 'CoHost', 'friend@example.test');
    await friend.evaluate(() => window.__lobby.cmd('join', ['#night-owls']));
    await expect(friend.locator('[data-chat-context]')).toHaveText('#night-owls');
    await owner.evaluate(() => window.__lobby.cmd('cohost', ['add', 'CoHost'], '#night-owls'));
    await expect(friend.locator('[data-roomtools]')).toBeVisible();
    await friend.context().close();
    await owner.click('[data-roomtools]');
    owner.once('dialog', (d) => d.accept());
    await owner.getByRole('button', { name: 'Remove verified co-host: CoHost', exact: true }).click();
    const back = await visitor(browser, 'BackCoHost', 'friend@example.test');
    await back.evaluate(() => window.__lobby.cmd('join', ['#night-owls']));
    await expect(back.locator('[data-chat-context]')).toHaveText('#night-owls');
    await expect(back.locator('[data-roomtools]')).toBeHidden();
    expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await owner.context().close(); await back.context().close();
});
test('unavailable owner sign-in offers guest entry without inventing verified ownership', async ({ page }) => {
    await page.goto(url(true)); await page.fill('[data-nick]', 'GuestAgain'); await page.click('[data-enter]');
    await expect(page.locator('[data-gate-status]')).toContainText('sign-in is unavailable');
    await page.click('[data-gate-guest]'); await expect(page.locator('[data-app]')).toBeVisible();
    expect(await page.evaluate(() => window.__lobby.verified)).toBe(false);
});
