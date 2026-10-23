const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/admin/';
function url(baseURL, extra = {}) {
    const params = new URLSearchParams({
        preview: 'local-preview-key-0001',
        relay: hangoutRelayWsBase(baseURL, `signin-${randomUUID()}`),
        ...extra
    });
    return `${ROOT}?${params}`;
}

test('email callback opens the real local moderation queue without another click', async ({ page, baseURL }) => {
    await page.goto(url(baseURL, { 'signed-in': '1', devadmin: 'local-dev-admin-key-0001' }));
    await expect(page.locator('[data-panel]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!window.__admin.state)).toBe(true);
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    expect(await page.evaluate(() => sessionStorage.getItem('signed-in'))).toBeNull();
});

test('a supplied callback marker cannot grant staff access', async ({ page, baseURL }) => {
    await page.goto(url(baseURL, { 'signed-in': '1' }));
    await expect(page.locator('[data-status]')).toContainText('Not signed in as a site moderator');
    await expect(page.locator('[data-panel]')).toBeHidden();
    expect(await page.evaluate(() => window.__admin.state)).toBeNull();
    await expect(page.locator('[data-signin]')).toBeFocused();
});

test('opening the panel directly still allows an explicit connection', async ({ page, baseURL }) => {
    await page.goto(url(baseURL, { devadmin: 'local-dev-admin-key-0001' }));
    expect(await page.evaluate(() => window.__admin.ws)).toBeNull();
    await page.getByRole('button', { name: 'Open the panel', exact: true }).click();
    await expect(page.locator('[data-panel]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!window.__admin.state)).toBe(true);
});

test('a stalled callback connection explains the retry without reconnecting in a loop', async ({ page, baseURL }) => {
    const sockets = [];
    await page.clock.install();
    await page.routeWebSocket((address) => address.pathname.endsWith('/lobby-admin'), (socket) => {
        sockets.push(socket); // Deliberately never send the server's hello/welcome.
    });
    await page.goto(url(baseURL, { 'signed-in': '1' }));
    await expect(page.locator('[data-status]')).toContainText('Connecting');
    await expect.poll(() => sockets.length).toBe(1);
    await page.clock.fastForward(13000);
    await expect(page.locator('[data-status]')).toContainText('didn’t respond');
    await expect(page.locator('[data-panel]')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open the panel', exact: true })).toBeFocused();
    await page.clock.fastForward(30000);
    expect(sockets).toHaveLength(1);
    await page.getByRole('button', { name: 'Open the panel', exact: true }).click();
    await expect.poll(() => sockets.length).toBe(2);
});

test('a welcome without the review snapshot never presents an empty queue as loaded', async ({ page, baseURL }) => {
    await page.clock.install();
    await page.routeWebSocket((address) => address.pathname.endsWith('/lobby-admin'), (socket) => {
        socket.onMessage((raw) => {
            if (JSON.parse(raw).t === 'hello') socket.send(JSON.stringify({ t: 'welcome', nick: 'Helper', band: true }));
        });
        socket.send(JSON.stringify({ t: 'hello', role: 'owner' }));
    });
    await page.goto(url(baseURL, { 'signed-in': '1' }));
    await expect(page.locator('[data-status]')).toHaveText('Loading the review queue…');
    await expect(page.locator('[data-panel]')).toBeHidden();
    await page.clock.fastForward(13000);
    await expect(page.locator('[data-status]')).toContainText('didn’t respond');
    expect(await page.evaluate(() => window.__admin.state)).toBeNull();
});
