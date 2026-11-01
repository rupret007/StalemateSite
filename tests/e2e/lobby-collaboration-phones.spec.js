// These run in the configured iPhone WebKit and Android projects. Media-device
// hardware and actual YouTube playback remain separate acceptance checks.
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

test('phone visitors chat and draw together, retain drafts on reconnect, and get no missed backlog', async ({ page, browser, baseURL }) => {
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    const relay = hangoutRelayWsBase(baseURL, `phone-${randomUUID()}`);
    const url = `/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`;
    const hostContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
        const host = await hostContext.newPage(); await host.goto(url);
        await host.fill('[data-nick]', 'PhoneRoomHost'); await host.click('[data-enter]');
        await expect(host.locator('[data-app]')).toBeVisible();
        await host.fill('[data-text]', 'Before this phone joined'); await host.press('[data-text]', 'Enter');
        await expect(host.locator('[data-buffer]')).toContainText('Before this phone joined');
        await page.goto(url); await page.fill('[data-nick]', 'PhoneVisitor'); await page.click('[data-enter]');
        await expect(page.locator('[data-app]')).toBeVisible();
        await expect(page.locator('[data-buffer]')).not.toContainText('Before this phone joined');
        await page.fill('[data-text]', 'Hello from this phone'); await page.locator('[data-say] button[type="submit"]').click();
        await expect(host.locator('[data-buffer]')).toContainText('Hello from this phone');
        await host.click('[data-start="art"]');
        await expect(host.locator('[data-act-canvas]')).toBeVisible();
        const channel = await host.evaluate(() => __lobby.active);
        await page.evaluate((channel) => __lobby.cmd('join', [channel]), channel);
        await expect(page.locator('[data-act-canvas]')).toBeVisible();
        const box = await page.locator('[data-act-canvas]').boundingBox();
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await expect.poll(() => host.evaluate(() => __lobbyRoom.state.room.strokes.length)).toBeGreaterThan(0);
        await page.fill('[data-text]', 'My unsent phone draft');
        await page.evaluate(() => __lobby.ws.close());
        await expect.poll(() => page.evaluate(() => __lobby.ws?.readyState)).toBe(1);
        await expect(page.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(page.locator('[data-buffer]')).not.toContainText('Hello from this phone');
        await page.evaluate((channel) => __lobby.cmd('join', [channel]), channel);
        await expect(page.locator('[data-chat-context]')).toHaveText(channel);
        await expect(page.locator('[data-text]')).toHaveValue('My unsent phone draft');
        expect(errors).toEqual([]);
    } finally { await hostContext.close(); }
});

test('phone watch room receives host play, pause and seek changes', async ({ page, browser, baseURL }) => {
    const relay = hangoutRelayWsBase(baseURL, `watch-phone-${randomUUID()}`);
    const url = `/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const fakeYouTube = path.join(__dirname, 'support/fake-youtube.js');
    const prepare = async (target, nick) => {
        await target.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
        await target.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ path: fakeYouTube, contentType: 'text/javascript' }));
        await target.goto(url); await target.fill('[data-nick]', nick); await target.click('[data-enter]');
        await expect(target.locator('[data-app]')).toBeVisible();
    };
    try {
        const host = await context.newPage(); await prepare(host, 'PhoneWatchHost');
        await host.click('[data-start="watch"]');
        await host.fill('[data-act-url]', 'https://youtu.be/oh5p5f5_-7A'); await host.press('[data-act-url]', 'Enter');
        await expect.poll(() => host.evaluate(() => window.__ytLog?.length || 0)).toBe(1);
        const channel = await host.evaluate(() => __lobby.active);
        await prepare(page, 'PhoneWatcher'); await page.evaluate((channel) => __lobby.cmd('join', [channel]), channel);
        await expect.poll(() => page.evaluate(() => __lobbyRoom.state.room.video?.source?.id)).toBe('oh5p5f5_-7A');
        await expect.poll(() => page.evaluate(() => window.__ytLog?.length || 0)).toBe(1);
        // The player adapter is a named fixture; the socket and authoritative
        // room changes are real, including the visitor's inability to control it.
        await host.evaluate(() => { __ytLog[0].pauseVideo(); __ytLog[0].seekTo(42); });
        await expect.poll(() => page.evaluate(() => __lobbyRoom.state.room.video?.playing)).toBe(false);
        await expect.poll(() => page.evaluate(() => __lobbyRoom.state.room.video?.pos)).toBe(42);
        await expect(page.locator('[data-act-load]')).toBeHidden();
    } finally { await context.close(); }
});
