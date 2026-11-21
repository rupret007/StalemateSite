// Shared Paint Along playback and layout acceptance with deterministic YouTube/media fixtures.
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { test: base, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
const { chromiumMediaLaunch, installWebKitMedia } = require('./support/webkit-media');
const { TEST_SLUG } = require('./support/lobby-fixture');

const test = base.extend({
    launchOptions: [async ({ browserName, launchOptions }, use) => {
        await use(chromiumMediaLaunch(browserName, launchOptions, [
            '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'
        ]));
    }, { scope: 'worker' }]
});
test.use({ permissions: ['camera', 'microphone'] });

const SLUG = `${TEST_SLUG}`;
const KEY = 'local-preview-key-0001';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');

let relayWs;
test.beforeEach(async ({ baseURL }) => { relayWs = hangoutRelayWsBase(baseURL, `paint-along-${randomUUID()}`); });
const lobbyUrl = () => `/r/${SLUG}/lobby/?preview=${KEY}&relay=${encodeURIComponent(relayWs)}`;

async function participant(browser, nick, viewport) {
    const context = await browser.newContext({ permissions: ['camera', 'microphone'], viewport });
    if (browser.browserType().name() === 'webkit') await context.addInitScript(installWebKitMedia);
    await context.route(/youtube\.com|ytimg|googlevideo/, route => route.abort());
    await context.route('https://www.youtube.com/iframe_api', route => route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
    const page = await context.newPage();
    await page.goto(lobbyUrl());
    await page.fill('[data-nick]', nick);
    await page.click('[data-enter]');
    await expect(page.locator('[data-app]')).toBeVisible();
    return page;
}
async function driftAtCommonTime(a, b) {
    const samples = await Promise.all([a, b].map(page => page.evaluate(() => ({
        pos: window.__ytLog[0].getCurrentTime(), playing: window.__ytLog[0].getPlayerState() === 1,
        at: performance.timeOrigin + performance.now()
    }))));
    if (samples.some(sample => !sample.playing)) return Infinity;
    const at = Math.max(...samples.map(sample => sample.at));
    const positions = samples.map(sample => sample.pos + (at - sample.at) / 1000);
    return Math.abs(positions[0] - positions[1]);
}

test('participants share pause, play, seek and late-join state; responsive three-person views', async ({ browser }) => {
    const a = await participant(browser, 'SyncPainterA', { width: 1440, height: 900 });
    const b = await participant(browser, 'SyncPainterB', { width: 1440, height: 900 });
    const c = await participant(browser, 'SyncPainterC', { width: 390, height: 844 });
    try {
        await a.click('[data-start="bobross"]');
        // Room creation is asynchronous. Wait for the host's real player before
        // reading the current room and inviting the other two participants.
        await expect(a.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
        const room = await a.evaluate(() => window.__lobby.active);
        await b.evaluate(channel => window.__lobby.cmd('join', [channel]), room);
        if (await b.locator('[data-cam-no]').isVisible()) await b.click('[data-cam-no]');
        await b.click('[data-show="chat"]');
        await expect.poll(() => b.evaluate(() => window.__lobbyRoom?.state.room.video?.source?.id)).toBeTruthy();
        await expect(b.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');

        await a.evaluate(() => window.__ytLog[0].pauseVideo());
        await expect(b.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'paused', { timeout: 1500 });
        await a.evaluate(() => window.__ytLog[0].playVideo());
        await expect(b.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing', { timeout: 2500 });
        await a.evaluate(() => window.__ytLog[0].seekTo(120));
        await expect.poll(() => driftAtCommonTime(a, b)).toBeLessThan(1);

        await c.evaluate(channel => window.__lobby.cmd('join', [channel]), room);
        if (await c.locator('[data-cam-no]').isVisible()) await c.click('[data-cam-no]');
        await expect(c.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
        await expect.poll(() => driftAtCommonTime(a, c)).toBeLessThan(1);
        for (const page of [a, b, c]) {
            const dismiss = page.locator('[data-cam-no]');
            if (await dismiss.isVisible()) await dismiss.click();
        }

        const camOn = channel => window.__lobby.ws.send(JSON.stringify({ t: 'cam', ch: channel, on: true, adult18: true }));
        await Promise.all([a, b, c].map(page => page.evaluate(camOn, room)));
        await expect.poll(() => a.evaluate(() => document.querySelectorAll('[data-act-tiles] .camera-tile').length)).toBe(3);

        const output = path.resolve(__dirname, '../../test-results/paint-along');
        fs.mkdirSync(output, { recursive: true });
        await a.setViewportSize({ width: 1440, height: 900 });
        await a.screenshot({ path: path.join(output, 'paint-along-1440x900.png'), animations: 'disabled' });
        await c.screenshot({ path: path.join(output, 'paint-along-390x844.png'), animations: 'disabled' });
        await expect(a.locator('[data-act-canvas]')).toBeHidden();
        await expect(a.locator('[data-paint-canvas-hint]')).toContainText('Point your camera at your canvas');
        const overflow = await c.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        expect(overflow).toBe(false);
    } finally {
        await Promise.all([a, b, c].map(page => page.context().close()));
    }
});
