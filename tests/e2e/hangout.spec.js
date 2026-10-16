// Two real browsers in one hidden room, synced over the local stand-in for the relay Worker.
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const SLUG = '45662413410ed051';
const KEY = 'local-preview-key-0001';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');

test.use({
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] }
});
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium carries the two-browser sync suite');

let relay;
test.beforeAll(async ({ baseURL }) => {
    const { startRelay } = await import('../../scripts/hangout-relay-dev.mjs');
    relay = await startRelay({ previewKey: KEY, origins: new URL(baseURL).origin });
});
test.afterAll(async () => { if (relay) await relay.close(); });

async function openBrowser(browser) {
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
    await context.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
    await context.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
    return context.newPage();
}
const roomUrl = (extra = '') => `/r/${SLUG}/?preview=${KEY}&relay=ws://127.0.0.1:${relay.port}${extra}`;

async function hostAndGuest(browser) {
    const host = await openBrowser(browser);
    await host.goto(roomUrl());
    await host.fill('[data-name]', 'Jeff');
    await host.click('[data-enter]');
    await expect(host.locator('[data-room]')).toBeVisible();
    const invite = host.url();
    expect(invite).toMatch(/#r=[A-Za-z0-9_-]{24}&h=/);
    const guest = await openBrowser(browser);
    await guest.goto(invite);
    await expect(guest.locator('[data-gate-title]')).toHaveText('You’re invited');
    await guest.fill('[data-name]', 'Karen');
    await guest.click('[data-enter]');
    await expect(guest.locator('[data-peers]')).toContainText('2 here');
    await expect(host.locator('[data-peers]')).toContainText('Karen');
    return { host, guest, invite };
}

async function drawLine(page) {
    const box = await page.locator('[data-canvas]').boundingBox();
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(box.x + 40 + i * 20, box.y + 40 + i * 10);
    await page.mouse.up();
}

test('without the preview key the room stays shut and never dials the relay', async ({ browser }) => {
    const page = await openBrowser(browser);
    const sockets = [];
    page.on('websocket', (ws) => sockets.push(ws.url()));
    await page.goto(`/r/${SLUG}/`);
    await expect(page.locator('[data-gate-title]')).toHaveText('Not open yet');
    await expect(page.locator('[data-enter]')).toBeHidden();
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
    expect(sockets).toEqual([]);
});

test('a wrong preview key is refused by the relay', async ({ browser }) => {
    const page = await openBrowser(browser);
    await page.goto(`/r/${SLUG}/?preview=wrong-key-wrong-key&relay=ws://127.0.0.1:${relay.port}`);
    await page.fill('[data-name]', 'Nope');
    await page.click('[data-enter]');
    await expect(page.locator('[data-gate-status]')).toContainText('Couldn’t get in');
});

test('drawing, chat and the host wipe sync between two browsers', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);
    await drawLine(guest);
    await expect.poll(() => host.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThan(0);
    await expect.poll(() => host.evaluate(() => window.__hangout.state.strokes[0].pts.length)).toBeGreaterThan(5);
    await guest.fill('[data-text]', 'happy little trees');
    await guest.press('[data-text]', 'Enter');
    await expect(host.locator('[data-log]')).toContainText('Karen: happy little trees');
    await host.fill('[data-text]', 'beat devil');
    await host.press('[data-text]', 'Enter');
    await expect(guest.locator('[data-log]')).toContainText('Jeff: beat devil');

    await expect(guest.locator('[data-clear]')).toBeHidden();
    await expect(guest.locator('[data-picks]')).toBeHidden();
    // A guest forging a host wipe is ignored: no valid signature.
    await guest.evaluate(async () => {
        const app = window.__hangout;
        const frame = await window.HangoutCore.seal(app.key, { type: 'host', body: { kind: 'clear', seq: Date.now() + 9e9 }, sig: 'AAAA' });
        app.ws.send(JSON.stringify(frame));
    });
    await host.waitForTimeout(400);
    expect(await host.evaluate(() => window.__hangout.state.strokes.length)).toBeGreaterThan(0);

    await host.click('[data-clear]');
    await expect.poll(() => guest.evaluate(() => window.__hangout.state.strokes.length)).toBe(0);
});

test('host-driven YouTube stays in sync: load, play, pause, seek, late joiner', async ({ browser }) => {
    const { host, guest, invite } = await hostAndGuest(browser);
    await host.click('[data-pick-yt="oh5p5f5_-7A"]');
    const gYt = guest.locator('[data-fake-yt]');
    await expect(gYt).toHaveAttribute('data-video-id', 'oh5p5f5_-7A');
    await expect(gYt).toHaveAttribute('data-state', 'playing');
    await host.waitForTimeout(1500);
    const drift = async () => {
        const h = await host.evaluate(() => window.__ytLog[0].getCurrentTime());
        const g = await guest.evaluate(() => window.__ytLog[0].getCurrentTime());
        return Math.abs(h - g);
    };
    expect(await drift()).toBeLessThan(1.0);

    await host.evaluate(() => { window.__ytLog[0].seekTo(120); window.__ytLog[0].pauseVideo(); });
    await expect(gYt).toHaveAttribute('data-state', 'paused');
    await expect.poll(() => guest.evaluate(() => window.__ytLog[0].getCurrentTime())).toBeGreaterThan(119);

    await host.evaluate(() => window.__ytLog[0].playVideo());
    await expect(gYt).toHaveAttribute('data-state', 'playing');

    const late = await openBrowser(browser);
    await late.goto(invite);
    await late.fill('[data-name]', 'Latecomer');
    await late.click('[data-enter]');
    const lYt = late.locator('[data-fake-yt]');
    await expect(lYt).toHaveAttribute('data-video-id', 'oh5p5f5_-7A');
    await expect(lYt).toHaveAttribute('data-state', 'playing');
    await expect.poll(() => late.evaluate(() => window.__ytLog[0].getCurrentTime())).toBeGreaterThan(119);
});

test('guests cannot change the video; any YouTube link works for the host; Manic plays from the site', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);
    await expect(guest.locator('[data-load]')).toBeHidden();
    await host.fill('[data-url]', 'https://youtu.be/BtnyqIHTDMM');
    await host.click('[data-load] button');
    await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', 'BtnyqIHTDMM');
    await host.click('[data-pick-file="manic"]');
    await expect(guest.locator('[data-file]')).toBeVisible();
    await expect.poll(() => guest.evaluate(() => document.querySelector('[data-file]').src)).toContain('/assets/manic.mp4');
});

test('camera and mic are opt-in with a plain explainer, then connect peer to peer at capped size', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);
    expect(await host.evaluate(() => window.__hangout.av.stream)).toBeNull();
    await host.click('[data-cam]');
    await expect(host.locator('[data-ask]')).toBeVisible();
    await expect(host.locator('[data-ask-copy]')).toContainText('Tap Allow');
    await host.click('[data-ask-no]');
    expect(await host.evaluate(() => window.__hangout.av.cam)).toBe(false);

    await host.click('[data-cam]');
    await host.click('[data-ask-yes]');
    await expect(host.locator('[data-cam]')).toHaveText('Turn off my camera');
    const settings = await host.evaluate(() => window.__hangout.av.stream.getVideoTracks()[0].getSettings());
    expect(settings.width).toBeLessThanOrEqual(320);
    expect(settings.frameRate).toBeLessThanOrEqual(15);

    await guest.click('[data-mic]');
    await guest.click('[data-ask-yes]');
    const remote = guest.locator('[data-tiles] video').first();
    await expect.poll(() => remote.evaluate((v) => v.videoWidth), { timeout: 15000 }).toBeGreaterThan(0);
    await expect.poll(() => host.evaluate(() => {
        const e = [...window.__hangout.av.pcs.values()][0];
        return e && e.pc.connectionState;
    }), { timeout: 15000 }).toBe('connected');
    const bitrate = await host.evaluate(() => {
        const e = [...window.__hangout.av.pcs.values()][0];
        const s = e.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
        return s.getParameters().encodings[0].maxBitrate;
    });
    expect(bitrate).toBeLessThanOrEqual(250000);

    await host.click('[data-hangup]');
    expect(await host.evaluate(() => window.__hangout.av.stream)).toBeNull();
});

test('a fifth camera is refused politely', async ({ browser }) => {
    const { guest } = await hostAndGuest(browser);
    await guest.evaluate(() => ['x1', 'x2', 'x3', 'x4'].forEach((id) => window.__hangout.av.peers.add(id)));
    await guest.click('[data-cam]');
    await expect(guest.locator('[data-status]')).toContainText('Faces are full (4 max)');
    await expect(guest.locator('[data-ask]')).toBeHidden();
});

test('crawling every public page from the homepage never reaches the room', async ({ page, baseURL }) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const origin = new URL(baseURL).origin;
    const seen = new Set();
    const queue = ['/', '/404.html', '/play/'];
    while (queue.length && seen.size < 40) {
        const next = queue.shift();
        if (seen.has(next)) continue;
        seen.add(next);
        const res = await page.goto(next).catch(() => null);
        if (!res || !res.ok()) continue;
        const links = await page.$$eval('a[href], link[href], iframe[src], form[action]', (els) => els.map((e) => e.href || e.src || e.action));
        const html = await page.content();
        expect(html, next).not.toContain(SLUG);
        for (const link of links) {
            const u = new URL(link, origin);
            expect(u.pathname, `${next} links ${u.pathname}`).not.toMatch(/^\/r(\/|$)/);
            if (u.origin === origin && !/\.(png|jpe?g|svg|mp4|m4a|ico|css|js|webmanifest)$/.test(u.pathname)) queue.push(u.pathname);
        }
    }
    expect(seen.size).toBeGreaterThan(2);
});

test('Bob Ross Paint-Along: picker, palette, brushes, pause-for-everyone, catch up and nudge', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);
    await expect(host.locator('[data-bob]')).toBeHidden();
    await host.click('[data-bob-toggle]');
    await expect(host.locator('[data-bob-episodes] .ep')).toHaveCount(12);
    await expect(host.locator('[data-bob-palette] .swatch')).toHaveCount(12);
    await expect(host.locator('[data-bob-palette] [aria-label="Phthalo Blue"]')).toBeVisible();
    await expect(guest.locator('[data-bob-episodes]')).toBeHidden();

    // Picking an episode loads it for everyone and flips guests into Bob mode.
    await host.click('[data-bob-ep="uj5FE70BcB0"]');
    await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-video-id', 'uj5FE70BcB0');
    await expect(guest.locator('body')).toHaveClass(/bob-mode/);
    await expect(guest.locator('[data-bob-now]')).toContainText('Waterside Way · S8 E4');
    await expect(guest.locator('[data-bob-hold]')).toBeHidden();
    await expect(guest.locator('[data-bob-catchup]')).toBeVisible();

    // Painting in Van Dyke Brown with the fan brush syncs across.
    await guest.click('[data-bob-palette] [aria-label="Van Dyke Brown"]');
    await guest.click('[data-bob-brushes] .brush:has-text("Fan brush")');
    await drawLine(guest);
    await expect.poll(() => host.evaluate(() => window.__hangout.state.strokes.map((s) => `${s.color}/${s.size}`))).toContain('#221b15/16');

    // Guest nudges, host pauses for everyone, then resumes.
    await guest.click('[data-bob-nudge]');
    await expect(host.locator('[data-status]')).toContainText('needs a sec');
    await host.click('[data-bob-hold]');
    await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'paused');
    await expect(host.locator('[data-bob-hold]')).toHaveText('Back to painting');
    await host.click('[data-bob-hold]');
    await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');

    // A guest who wanders off can catch up to the host in one tap.
    await guest.evaluate(() => { window.__ytLog[0].seekTo(400); });
    await guest.click('[data-bob-catchup]');
    await expect.poll(() => guest.evaluate(() => window.__ytLog[0].getCurrentTime())).toBeLessThan(30);

    // Host rewinds 15s for everyone.
    await host.evaluate(() => window.__ytLog[0].seekTo(100));
    await host.click('[data-bob-rewind]');
    await expect.poll(() => guest.evaluate(() => window.__ytLog[0].getCurrentTime())).toBeLessThan(95);
});

test('show your real canvas: opt-in, rectangular tile for everyone, still capped', async ({ browser }) => {
    const { host, guest } = await hostAndGuest(browser);
    await host.click('[data-canvas-cam]');
    await expect(host.locator('[data-ask-title]')).toHaveText('Show your real canvas?');
    await host.click('[data-ask-yes]');
    await expect(host.locator('[data-canvas-cam]')).toHaveText('Stop showing my canvas');
    const w = await host.evaluate(() => window.__hangout.av.stream.getVideoTracks()[0].getSettings().width);
    expect(w).toBeLessThanOrEqual(640);
    await expect(host.locator('[data-tile="me"]')).toHaveClass(/tile--canvas/);
    await guest.click('[data-mic]');
    await guest.click('[data-ask-yes]');
    await expect(guest.locator('[data-tiles] .tile--canvas')).toHaveCount(1, { timeout: 15000 });
    await expect.poll(() => host.evaluate(() => {
        const e = [...window.__hangout.av.pcs.values()][0];
        const s = e && e.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
        return s ? s.getParameters().encodings[0].maxBitrate : null;
    }), { timeout: 15000 }).toBeLessThanOrEqual(250000);
    await host.click('[data-canvas-cam]');
    expect(await host.evaluate(() => window.__hangout.av.canvas)).toBe(false);
    await expect(host.locator('[data-tile="me"]')).toHaveCount(0);
});

test('the name box starts blank, needs a name, offers a dice name, and is remembered', async ({ browser }) => {
    const page = await openBrowser(browser);
    await page.goto(roomUrl());
    await expect(page.locator('[data-name]')).toHaveValue('');
    await page.click('[data-enter]');
    await expect(page.locator('[data-gate-status]')).toContainText('Type a name');
    await expect(page.locator('[data-room]')).toBeHidden();
    await expect(page.locator('[data-dice]')).toHaveText('🎲 Make me a name');
    await expect(page.locator('[data-name]')).toHaveAttribute('placeholder', 'Type a nickname… or roll one →');
    expect((await page.locator('[data-dice]').boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.click('[data-dice]');
    await expect(page.locator('[data-dice]')).toHaveText('🎲 Roll again');
    await expect(page.locator('[data-name]')).toHaveValue(/^[A-Z][A-Za-z0-9-]{2,19}$/);
    await page.fill('[data-name]', 'Remembered');
    await page.click('[data-enter]');
    await expect(page.locator('[data-room]')).toBeVisible();
    await page.goto(roomUrl());
    await expect(page.locator('[data-name]')).toHaveValue('Remembered');
});
