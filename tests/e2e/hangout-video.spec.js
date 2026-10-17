// Room video: Webex-style basics on the peer-to-peer mesh, two real browsers over the local relay.
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const SLUG = '45662413410ed051';
const KEY = 'local-preview-key-0001';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');
const SHOTS = process.env.HANGOUT_VIDEO_SHOTS || '';

test.use({
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] }
});
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium carries the two-browser call suite');

let relay;
test.beforeAll(async ({ baseURL }) => {
    const { startRelay } = await import('../../scripts/hangout-relay-dev.mjs');
    relay = await startRelay({ previewKey: KEY, origins: new URL(baseURL).origin });
});
test.afterAll(async () => { if (relay) await relay.close(); });

async function openBrowser(browser, opts = {}) {
    const context = await browser.newContext(Object.assign({ permissions: ['camera', 'microphone'] }, opts));
    await context.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
    await context.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    return page;
}
const roomUrl = (extra = '') => `/r/${SLUG}/?preview=${KEY}&relay=ws://127.0.0.1:${relay.port}${extra}`;

async function join(page, url, name) {
    await page.goto(url);
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect(page.locator('[data-room]')).toBeVisible();
}
async function camOn(page) {
    await page.click('[data-cam]');
    await page.click('[data-ask-yes]');
    await expect(page.locator('[data-cam]')).toHaveText('Turn off my camera');
}
async function micOn(page) {
    await page.click('[data-mic]');
    await page.click('[data-ask-yes]');
    await expect(page.locator('[data-mic]')).toHaveText('Mute my mic');
}
async function call(browser, opts) {
    const host = await openBrowser(browser, opts);
    await join(host, roomUrl(), 'Jeff');
    const guest = await openBrowser(browser, opts);
    await join(guest, host.url(), 'Karen');
    await expect(guest.locator('[data-peers]')).toContainText('2 here');
    await camOn(host);
    await micOn(host);
    await camOn(guest);
    await expect.poll(() => guest.evaluate(() => {
        const v = document.querySelector('.tile:not([data-tile="me"]) video');
        return v ? v.videoWidth : 0;
    }), { timeout: 15000 }).toBeGreaterThan(0);
    return { host, guest };
}
const sentVideo = (page) => page.evaluate(() => {
    const e = [...window.__hangout.av.pcs.values()][0];
    const s = e && e.senders.video;
    return s ? s.getParameters().encodings[0] : null;
});

test('grid by default, speaker view and pin ask the sender for the sharp feed', async ({ browser }) => {
    const { host, guest } = await call(browser);
    await expect(guest.locator('[data-tiles]')).toHaveAttribute('data-view', 'grid');
    await expect(guest.locator('[data-tiles] .tile')).toHaveCount(2);
    await expect(guest.locator('[data-tiles] .tile').last()).toHaveAttribute('data-tile', 'me');
    expect((await sentVideo(host)).maxBitrate).toBeLessThanOrEqual(250000);

    // Pin the host big: the host's sender to this guest steps up, never above 600 kbps.
    const hostTile = guest.locator('.tile:not([data-tile="me"])');
    await hostTile.locator('.more').click();
    await guest.click('[data-tile-menu] button:has-text("Pin big for me")');
    await expect(guest.locator('[data-tiles]')).toHaveAttribute('data-view', 'speaker');
    await expect(hostTile).toHaveClass(/tile--big/);
    await expect.poll(async () => (await sentVideo(host)).maxBitrate).toBe(600000);
    if (SHOTS) { await guest.setViewportSize({ width: 1280, height: 900 }); await guest.locator('.call').screenshot({ path: `${SHOTS}/05-desktop-speaker.png` }); }
    expect((await sentVideo(host)).scaleResolutionDownBy).toBe(1);

    // Back to grid: the sender drops back to a thumbnail.
    await guest.click('[data-view-toggle]');
    await expect(guest.locator('[data-tiles]')).toHaveAttribute('data-view', 'grid');
    await expect.poll(async () => (await sentVideo(host)).maxBitrate).toBeLessThanOrEqual(250000);
    expect(host.errors.concat(guest.errors)).toEqual([]);
});

test('connection bars show on every remote tile and a dead link drops to audio only', async ({ browser }) => {
    const { host, guest } = await call(browser);
    const q = guest.locator('.tile:not([data-tile="me"]) .q');
    await expect(q).toHaveAttribute('aria-label', /connection/i, { timeout: 10000 });
    // Simulate three bad samples on the guest's link to the host.
    await guest.evaluate(() => {
        const e = [...window.__hangout.av.pcs.values()][0];
        e.hist = ['bad', 'bad'];
        e.tier = 'weak';
        e.pc.getStats = async () => new Map([['p', { type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 1.2, availableOutgoingBitrate: 20000 }]]);
    });
    await expect(guest.locator('[data-status]')).toContainText('video paused, audio kept', { timeout: 8000 });
    await expect.poll(async () => (await sentVideo(guest)).active).toBe(false);
    await expect(guest.locator('.tile:not([data-tile="me"])')).toHaveClass(/tile--nocam/);
    expect((await sentVideo(host)).active).toBe(true);
});

test('raise hand and reactions reach everyone; junk reactions are dropped', async ({ browser }) => {
    const { host, guest } = await call(browser);
    await guest.click('[data-hand]');
    await expect(guest.locator('[data-hand]')).toHaveText('Lower hand');
    await expect(host.locator('[data-hands]')).toContainText('Karen');
    await expect(host.locator('.tile:not([data-tile="me"]) .badge')).toContainText('✋');
    await guest.click('[data-reacts] button[data-r="🤘"]');
    await expect(host.locator('.tile:not([data-tile="me"]) .react')).toContainText('🤘');
    await guest.evaluate(() => window.__hangoutSend && window.__hangoutSend({ type: 'react', r: '<img src=x>' }));
    await expect(host.locator('.react span')).not.toContainText('<img');
    await guest.click('[data-hand]');
    await expect(host.locator('[data-hands]')).toBeHidden();
});

test('host can mute, turn a camera off, spotlight, lock and take someone off faces; guests cannot forge it', async ({ browser }) => {
    const { host, guest } = await call(browser);
    await micOn(guest);
    const guestTile = host.locator('.tile:not([data-tile="me"])');

    // A guest forging a host action (unsigned) changes nothing.
    await guest.evaluate(() => window.__hangoutSend({ type: 'host', body: { kind: 'camoff', seq: Date.now() + 1e9, target: '*' }, sig: 'AAAA' }));
    await host.waitForTimeout(500);
    expect(await host.evaluate(() => window.__hangout.av.cam)).toBe(true);

    await guestTile.locator('.more').click();
    await host.click('[data-tile-menu] button:has-text("Mute them")');
    await expect(guest.locator('[data-mic]')).toHaveText('Turn on my mic');
    await expect(guest.locator('[data-status]')).toContainText('The host muted you');
    // Muted, never force-unmuted: the guest can come back on their own.
    await guestTile.locator('.more').click();
    await host.click('[data-tile-menu] button:has-text("Turn their camera off")');
    await expect(guest.locator('[data-cam]')).toHaveText('Turn on my camera');

    await host.locator('[data-tile="me"] .more').click();
    await host.click('[data-tile-menu] button:has-text("Spotlight me for everyone")');
    await expect(guest.locator('.tile:not([data-tile="me"])')).toHaveClass(/tile--big/);

    // Muted by the host, back on by choice (no second explainer).
    await guest.click('[data-mic]');
    await expect(guest.locator('[data-mic]')).toHaveText('Mute my mic');
    await expect(host.locator('.tile:not([data-tile="me"])')).toHaveCount(1);

    await host.click('[data-lock]');
    await expect(host.locator('[data-lock]')).toHaveText('Unlock faces');
    const late = await openBrowser(browser);
    await join(late, host.url(), 'Latecomer');
    await late.click('[data-cam]');
    await expect(late.locator('[data-status]')).toContainText('locked');
    await host.click('[data-lock]');

    await guestTile.locator('.more').click();
    await host.click('[data-tile-menu] button:has-text("Take them off faces")');
    await expect(guest.locator('[data-status]')).toContainText('took you off faces');
    await expect(host.locator('.tile:not([data-tile="me"])')).toHaveCount(0);
    await guest.click('[data-cam]');
    await expect(guest.locator('[data-status]')).toContainText('took you off faces');
});

test('report hides the person for you and tells the host', async ({ browser }) => {
    const { host, guest } = await call(browser);
    await guest.locator('.tile:not([data-tile="me"]) .more').click();
    await guest.click('[data-tile-menu] button:has-text("Report to the host")');
    await expect(guest.locator('.tile:not([data-tile="me"])')).toHaveCount(0);
    // The host is the one reported here, so they see their own report notice.
    await expect(host.locator('[data-status]')).toContainText('reported');
});

test('settings: device pickers, music mode, and a background that never breaks the camera', async ({ browser }) => {
    test.setTimeout(90000);
    const { host, guest } = await call(browser);
    await guest.click('[data-settings]');
    await expect(guest.locator('[data-settings-dlg]')).toBeVisible();
    await expect.poll(() => guest.locator('[data-dev-cam] option').count()).toBeGreaterThan(0);
    await expect(guest.locator('[data-bg-picks] button')).toHaveCount(6);
    if (SHOTS) await guest.screenshot({ path: `${SHOTS}/04-settings-desktop.png` });
    await guest.click('[data-bg="checkerboard"]');
    // Either the background runs (sender gets the processed track) or it falls back politely. Camera stays on.
    await expect.poll(() => guest.evaluate(() => {
        const a = window.__hangout.av;
        if (a.bg.loading) return 'loading';
        if (a.bg.proc) return a.stream.getVideoTracks()[0] === a.bg.proc.processedTrack ? 'running' : 'mismatch';
        return a.bg.choice === 'none' ? 'fell-back' : 'pending';
    }), { timeout: 45000 }).toMatch(/running|fell-back/);
    console.log('background result:', await guest.evaluate(() => (window.__hangout.av.bg.proc ? 'running' : `fell-back: ${window.__hangout.av.bg.error}`)));
    expect(await guest.evaluate(() => window.__hangout.av.cam)).toBe(true);
    const viaSender = await guest.evaluate(() => {
        const e = [...window.__hangout.av.pcs.values()][0];
        return e.senders.video.track === window.__hangout.av.stream.getVideoTracks()[0];
    });
    expect(viaSender).toBe(true);
    await guest.click('[data-bg="none"]');
    await expect.poll(() => guest.evaluate(() => window.__hangout.av.bg.proc)).toBeNull();

    await guest.click('[data-settings-close]');
    await micOn(guest);
    await guest.click('[data-settings]');
    await guest.check('[data-music]');
    await expect.poll(() => guest.evaluate(() => window.__hangout.av.stream.getAudioTracks()[0].getSettings().echoCancellation)).toBe(false);
    await expect.poll(() => guest.evaluate(() => {
        const e = [...window.__hangout.av.pcs.values()][0];
        return e.senders.audio.getParameters().encodings[0].maxBitrate;
    })).toBe(128000);
    await guest.click('[data-settings-close]');
    expect(host.errors.concat(guest.errors)).toEqual([]);
});

test('jam rooms: browser mic starts off and is labelled for talking only', async ({ browser }) => {
    const page = await openBrowser(browser);
    await join(page, roomUrl('&kind=jam'), 'Drummer');
    await expect(page.locator('[data-mic]')).toHaveText('Talk (browser mic)');
    await expect(page.locator('[data-jam-note]')).toContainText('WebJam');
    expect(await page.evaluate(() => window.__hangout.av.mic)).toBe(false);
});

test('a dropped relay connection reconnects and faces come back', async ({ browser }) => {
    const { host, guest } = await call(browser);
    const before = await guest.evaluate(() => window.__hangout.myId);
    await guest.evaluate(() => window.__hangout.ws.close(3000));
    await expect(guest.locator('[data-status]')).toContainText(/Reconnecting|Back in/);
    await expect.poll(() => guest.evaluate(() => window.__hangout.myId), { timeout: 15000 }).not.toBe(before);
    await expect.poll(() => host.evaluate(() => {
        const v = document.querySelector('.tile:not([data-tile="me"]) video');
        return v && v.videoWidth;
    }), { timeout: 20000 }).toBeGreaterThan(0);
    await expect(host.locator('.tile:not([data-tile="me"])')).toHaveCount(1, { timeout: 20000 });
});

test('phones: portrait tiles, call bar sticks to the bottom in thumb reach, 44px targets', async ({ browser }) => {
    const opts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
    const { host, guest } = await call(browser, opts);
    const tile = await guest.locator('.tile:not([data-tile="me"])').boundingBox();
    expect(tile.height).toBeGreaterThan(tile.width); // portrait
    await expect(guest.locator('[data-share]')).toBeHidden(); // no screen share on phones
    const bar = guest.locator('.callbar');
    await expect(bar).toHaveCSS('position', 'fixed');
    const vb = await bar.boundingBox();
    expect(vb.y + vb.height).toBeGreaterThan(844 - 4); // pinned to the bottom edge, in thumb reach
    for (const sel of ['[data-mic]', '[data-cam]', '[data-hand]']) {
        const b = await guest.locator(sel).boundingBox();
        expect(b.height, sel).toBeGreaterThanOrEqual(44);
    }
    const settings = await guest.evaluate(() => window.__hangout.av.rawCam.getSettings());
    expect(settings.frameRate).toBeLessThanOrEqual(20); // battery-friendly default
    if (SHOTS) {
        await guest.locator('.call').evaluate((e) => e.scrollIntoView());
        await guest.screenshot({ path: `${SHOTS}/01-phone-grid.png` });
        await host.locator('[data-reacts] button[data-r="🔥"]').click();
        await guest.locator('.tile:not([data-tile="me"]) .more').click();
        await guest.screenshot({ path: `${SHOTS}/02-phone-tile-menu.png` });
        await guest.click('[data-tile-menu] button:has-text("Pin big for me")');
        await guest.locator('.call').evaluate((e) => e.scrollIntoView());
        await guest.screenshot({ path: `${SHOTS}/03-phone-speaker.png` });
    }
});

test('camera blocked: one tap joins with voice only and the others see an audio tile', async ({ browser }) => {
    const host = await openBrowser(browser);
    await join(host, roomUrl(), 'Jeff');
    await camOn(host);
    const guest = await openBrowser(browser);
    await guest.addInitScript(() => {
        const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (c) => (c && c.video ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) : real(c));
    });
    await join(guest, host.url(), 'Karen');
    await guest.click('[data-cam]');
    await guest.click('[data-ask-yes]'); // camera explainer
    await expect(guest.locator('[data-ask-title]')).toHaveText('Camera’s not available');
    await guest.click('[data-ask-yes]'); // join with voice
    await expect(guest.locator('[data-mic]')).toHaveText('Mute my mic');
    await expect(guest.locator('[data-cam]')).toHaveText('Turn on my camera');
    await expect(guest.locator('[data-status]')).toContainText('voice only');
    expect(await guest.evaluate(() => window.__hangout.av.stream.getVideoTracks().length)).toBe(0);
    // The host sees Karen as an audio tile (initial, no video) and still sends their camera.
    const karen = host.locator('.tile:not([data-tile="me"])');
    await expect(karen).toHaveClass(/tile--nocam/, { timeout: 15000 });
    await expect(karen.locator('.nm')).toHaveText('Karen');
    await expect.poll(() => guest.evaluate(() => {
        const v = document.querySelector('.tile:not([data-tile="me"]) video');
        return v ? v.videoWidth : 0;
    }), { timeout: 15000 }).toBeGreaterThan(0);
    await expect.poll(() => host.evaluate(() => [...window.__hangout.av.pcs.values()][0].pc.connectionState), { timeout: 15000 }).toBe('connected');
});

test('send queue: a signaling burst never loses the offer or answer', async ({ browser }) => {
    const page = await openBrowser(browser);
    await join(page, roomUrl(), 'Burst');
    const kept = await page.evaluate(async () => {
        const send = window.__hangoutSend;
        const pace = window.__hangoutPace;
        pace.tokens = 0; pace.last = Date.now();
        await send({ type: 'rtc', to: 'x', sdp: { type: 'offer', sdp: 'v=0' } });
        for (let i = 0; i < 260; i += 1) await send({ type: 'rtc', to: 'x', ice: { candidate: `c${i}` } });
        await send({ type: 'rtc', to: 'x', sdp: { type: 'answer', sdp: 'v=0' } });
        return { len: pace.queue.length, ice: pace.queue.filter((q) => q.ice).length };
    });
    expect(kept.len).toBeLessThanOrEqual(200);
    expect(kept.len - kept.ice).toBeGreaterThanOrEqual(2); // offer + answer survived
});
