// Open lobby rooms: shared canvas, synced YouTube, 18+ camera gate (two browsers).
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const SLUG = '45662413410ed051';
const KEY = 'local-preview-key-0001';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');

test.use({
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] }
});
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium carries the lobby open-room suite');
test.describe.configure({ mode: 'serial' });

let relayWs;
test.beforeEach(async ({ baseURL }) => {
    relayWs = hangoutRelayWsBase(baseURL, `activities-${randomUUID()}`);
});

const lobbyUrl = () => `/r/${SLUG}/lobby/?preview=${KEY}&relay=${encodeURIComponent(relayWs)}`;

async function fan(browser, nick) {
    const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    await ctx.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
    await ctx.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
    const page = await ctx.newPage();
    await page.goto(lobbyUrl());
    await page.fill('[data-nick]', nick);
    await page.click('[data-enter]');
    await expect(page.locator('[data-app]')).toBeVisible();
    return page;
}

async function drawOnCanvas(page) {
    const box = await page.locator('[data-act-canvas]').boundingBox();
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(box.x + 30 + i * 25, box.y + 30 + i * 12);
    await page.mouse.up();
}

test('art room: strokes sync between two browsers; clear is host-only', async ({ browser }) => {
    const host = await fan(browser, 'ArtHost');
    const guest = await fan(browser, 'ArtGuest');
    const guestErrors = [];
    guest.on('pageerror', (e) => guestErrors.push(e));

    await host.click('[data-start="art"]');
    await expect(host.locator('[data-act-canvas]')).toBeVisible();
    const room = await host.evaluate(() => window.__lobby.active);
    await guest.evaluate((r) => window.__lobby.cmd('join', [r]), room);
    await guest.click('[data-show="chat"]');
    await expect(guest.locator('[data-act-canvas]')).toBeVisible();
    await expect.poll(() => guest.evaluate(() => window.__lobbyRoom?.state?.ch)).toBeTruthy();
    await guest.evaluate(() => {
        window.__lobby.ws.send(JSON.stringify({
            t: 'act', ch: window.__lobby.active, kind: 'stroke',
            stroke: { id: 't1', color: '#009ee8', size: 8, pts: [[0.2, 0.2], [0.5, 0.5], [0.7, 0.3]] }
        }));
    });
    await drawOnCanvas(guest);
    await expect.poll(() => host.evaluate(() => window.__lobbyRoom?.state?.room?.strokes?.length || 0)).toBeGreaterThan(1);

    const strokeId = await guest.evaluate(() => {
        const strokes = window.__lobbyRoom.state.room.strokes;
        const drawn = strokes.find((s) => s.id.startsWith('s'));
        return (drawn || strokes.at(-1)).id;
    });
    const hostPts = await host.evaluate((id) => window.__lobbyRoom.state.room.strokes.find((s) => s.id === id).pts.length, strokeId);
    const guestPts = await guest.evaluate((id) => window.__lobbyRoom.state.room.strokes.find((s) => s.id === id).pts.length, strokeId);
    expect(guestPts).toBe(hostPts);
    expect(guestErrors).toEqual([]);

    const camOn = (ch) => window.__lobby.ws.send(JSON.stringify({ t: 'cam', ch, on: true, adult18: true }));
    await Promise.all([host.evaluate(camOn, room), guest.evaluate(camOn, room)]);
    await expect.poll(() => host.evaluate(() => window.__lobbyRoom.state.pcs.size)).toBe(1);
    await expect.poll(() => guest.evaluate(() => window.__lobbyRoom.state.pcs.size)).toBe(1);
    await expect.poll(() => host.evaluate(() => [...window.__lobbyRoom.state.pcs.values()][0]?.pc?.signalingState)).toBe('stable');
    await expect.poll(() => guest.evaluate(() => [...window.__lobbyRoom.state.pcs.values()][0]?.pc?.signalingState)).toBe('stable');

    await expect(guest.locator('[data-act-clear]')).toBeHidden();
    await expect.poll(() => host.evaluate(() => window.__lobbyRoom.state.room.strokes.length)).toBeGreaterThan(0);
    await host.click('[data-act-clear]');
    await expect.poll(() => guest.evaluate(() => window.__lobbyRoom.state.room.strokes.length)).toBe(0);
    await host.context().close();
    await guest.context().close();
});

test('watch room: host loads YouTube and guest stays in sync', async ({ browser }) => {
    const host = await fan(browser, 'WatchHost');
    await host.click('[data-start="watch"]');
    await host.fill('[data-act-url]', 'https://youtu.be/oh5p5f5_-7A');
    await host.press('[data-act-url]', 'Enter');
    const room = await host.evaluate(() => window.__lobby.active);
    const guest = await fan(browser, 'WatchGuest');
    await guest.evaluate((r) => window.__lobby.cmd('join', [r]), room);
    await guest.click('[data-show="chat"]');
    await expect.poll(() => guest.evaluate(() => window.__lobbyRoom.state.room.video?.source?.id)).toBe('oh5p5f5_-7A');
    await Promise.all([host, guest].map(async (page) => {
        await expect(page.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', 'oh5p5f5_-7A');
        await expect(page.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
    }));
    const drift = async () => {
        const samples = await Promise.all([host, guest].map((page) => page.evaluate(() => ({
            position: window.__ytLog[0].getCurrentTime(),
            playing: window.__ytLog[0].getPlayerState() === 1,
            at: performance.timeOrigin + performance.now()
        }))));
        if (samples.some((sample) => !sample.playing)) return Infinity;
        // Page evaluations can complete at different times under CI load.
        // Compare both playing positions at one instant, not two wall times.
        const at = Math.max(...samples.map((sample) => sample.at));
        const [h, g] = samples.map((sample) => sample.position + (at - sample.at) / 1000);
        return Math.abs(h - g);
    };
    // The production player corrects drift every two seconds. Keep the same
    // 1.5s requirement and the existing 5s expectation budget for convergence.
    await expect.poll(drift).toBeLessThan(1.5);
    await host.context().close();
    await guest.context().close();
});

test('watch source changes wait for one player and a canceled room cannot start late playback', async ({ browser }) => {
    const host = await fan(browser, 'DelayedWatchHost');
    let guest, releaseApi;
    const blocked = new Promise((resolve) => { releaseApi = resolve; });
    let apiRequested = false;
    await host.route('https://www.youtube.com/iframe_api', async (route) => {
        apiRequested = true;
        await blocked;
        await route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' });
    });
    try {
        await host.click('[data-start="watch"]');
        await host.fill('[data-act-url]', 'https://youtu.be/oh5p5f5_-7A');
        await host.press('[data-act-url]', 'Enter');
        await expect.poll(() => apiRequested).toBe(true);
        await host.fill('[data-act-url]', 'https://youtu.be/uj5FE70BcB0');
        await host.press('[data-act-url]', 'Enter');
        await expect.poll(() => host.evaluate(() => __lobbyRoom.state.room.video?.source?.id)).toBe('uj5FE70BcB0');
        const channel = await host.evaluate(() => __lobby.active);
        guest = await fan(browser, 'DelayedWatchGuest');
        await guest.evaluate((channel) => __lobby.cmd('join', [channel]), channel);
        await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', 'uj5FE70BcB0');
        await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
        // Leave while both source requests share the pending API load. Neither
        // old request may construct or play a hidden room after it resolves.
        await host.click('[data-leave]');
        await expect(host.locator('[data-chat-context]')).toHaveText('#stalemate');
        releaseApi();
        await expect.poll(() => host.evaluate(() => !!window.YT)).toBe(true);
        expect(await host.evaluate(() => window.__ytLog.length)).toBe(0);
        await expect(host.locator('[data-activity]')).toBeHidden();
        await host.evaluate((channel) => __lobby.cmd('join', [channel]), channel);
        await expect(host.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', 'uj5FE70BcB0');
        await expect(host.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
        expect(await host.evaluate(() => window.__ytLog.length)).toBe(1);
        expect(await host.evaluate(() => __lobbyRoom.player.readyKey)).toBe('yt:uj5FE70BcB0');
    } finally {
        releaseApi();
        await host.context().close();
        if (guest) await guest.context().close();
    }
});

test('bob ross room: headline episode and paint canvas appear for host', async ({ browser }) => {
    const host = await fan(browser, 'BobHost');
    await host.click('[data-start="bobross"]');
    await expect(host.locator('[data-act-canvas]')).toBeVisible();
    await expect(host.locator('[data-bob-picks]')).toBeVisible();
    await expect.poll(() => host.evaluate(() => window.__lobbyRoom.state.room.video?.source?.id)).toBeTruthy();
    await host.context().close();
});
