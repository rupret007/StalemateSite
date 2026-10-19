const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
const KEY = 'local-preview-key-0001';
const DEVICE = `${'a'.repeat(22)}.${'b'.repeat(32)}`;
test.use({ permissions: ['camera', 'microphone'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
let testOrigin;
test.beforeAll(async ({ baseURL }) => { testOrigin = baseURL; });
const roomUrl = (extra = '') => `/r/45662413410ed051/?preview=${KEY}&relay=${encodeURIComponent(hangoutRelayWsBase(testOrigin))}${extra}`;
async function enter(page) {
    await page.fill('[data-name]', 'Media tester'); await page.click('[data-enter]');
    await expect(page.locator('[data-room]')).toBeVisible();
}

test('camera and precheck require an explicit adult confirmation before requesting devices', async ({ page }) => {
    await page.addInitScript(() => {
        window.mediaRequests = 0;
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (c) => { window.mediaRequests++; return original(c); };
    });
    await page.goto(roomUrl()); await page.click('[data-check-btn]');
    await expect(page.locator('[data-ask-copy]')).toContainText('18 or older');
    expect(await page.evaluate(() => window.mediaRequests)).toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-check]')).toBeHidden();
    await enter(page); await page.click('[data-cam]');
    await expect(page.locator('[data-ask-yes]')).toContainText('18+');
    await page.click('[data-ask-no]');
    expect(await page.evaluate(() => ({ calls: window.mediaRequests, adult: window.__hangout.av.adult18 }))).toEqual({ calls: 0, adult: false });
    await page.click('[data-cam]'); await page.click('[data-ask-yes]');
    await expect.poll(() => page.evaluate(() => window.__hangout.av.cam)).toBe(true);
    expect(await page.evaluate(() => window.__hangout.av.adult18)).toBe(true);
});

test('a direct invite without a lobby device makes no unauthenticated TURN request', async ({ page }) => {
    let requests = 0;
    await page.route((url) => url.pathname === '/room-turn', async (route) => { requests++; await route.fulfill({ status: 403 }); });
    await page.goto(roomUrl('&turn=/room-turn')); await enter(page);
    await expect(page.locator('[data-turn-status]')).toContainText('Join the lobby once');
    expect(requests).toBe(0);
});

test('refresh replaces active peer configuration and restarts ICE without storing credentials', async ({ page }) => {
    await page.clock.install({ time: new Date() });
    await page.addInitScript((device) => localStorage.setItem('hangout-dev', device), DEVICE);
    const payloads = [];
    await page.route((url) => url.pathname === '/room-turn', async (route) => {
        payloads.push(route.request().postDataJSON());
        await route.fulfill({ json: { iceServers: [{ urls: 'turn:fixture.example:3478', username: 'fixture-user', credential: `fixture-${payloads.length}` }], ttl: 60, expiresAt: Date.now() + 600000 } });
    });
    await page.goto(roomUrl('&turn=/room-turn')); await enter(page);
    await expect(page.locator('[data-turn-status]')).toContainText('relay available');
    await page.evaluate(() => {
        window.turnUpdates = []; window.turnRestarts = 0;
        window.__hangout.av.pcs.set('fixture', { pc: {
            getConfiguration: () => ({}),
            setConfiguration: (value) => window.turnUpdates.push(value),
            restartIce: () => window.turnRestarts++
        } });
    });
    await page.clock.fastForward(49000);
    await expect.poll(() => payloads.length).toBe(2);
    await expect.poll(() => page.evaluate(() => window.turnRestarts)).toBe(1);
    expect(payloads.every((p) => p.device === DEVICE && /^[a-f0-9]{64}$/.test(p.room))).toBe(true);
    expect(await page.evaluate(() => JSON.stringify(window.turnUpdates))).toContain('fixture-2');
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('fixture-2');
});

test('camera negotiation retains ICE candidates arriving before the encrypted offer', async ({ browser }) => {
    const contexts = [];
    try {
        const join = async (url, name) => {
            const context = await browser.newContext({ permissions: ['camera'] }); contexts.push(context);
            const page = await context.newPage(); await page.goto(url);
            await page.fill('[data-name]', name); await page.click('[data-enter]');
            await expect(page.locator('[data-room]')).toBeVisible();
            return page;
        };
        const host = await join(roomUrl(), 'OfferHost');
        const guest = await join(host.url(), 'OfferGuest');
        await guest.evaluate(() => {
            window.earlyCandidates = []; window.appliedCandidates = [];
            const addIceCandidate = RTCPeerConnection.prototype.addIceCandidate;
            RTCPeerConnection.prototype.addIceCandidate = async function (candidate) {
                await addIceCandidate.call(this, candidate);
                if (this.remoteDescription) window.appliedCandidates.push(candidate.candidate);
            };
            const original = __hangout.ws.onmessage;
            __hangout.ws.onmessage = async (event) => {
                const frame = JSON.parse(event.data);
                if (frame.c) {
                    const message = await HangoutCore.open(__hangout.key, frame);
                    if (message.type === 'rtc' && message.sdp) await new Promise((resolve) => setTimeout(resolve, 500));
                    if (message.type === 'rtc' && message.ice && !__hangout.av.pcs.get(frame.from)?.pc.remoteDescription) window.earlyCandidates.push(message.ice.candidate);
                }
                return original(event);
            };
        });
        await host.click('[data-cam]'); await host.click('[data-ask-yes]');
        await guest.click('[data-cam]'); await guest.click('[data-ask-yes]');
        await expect.poll(() => guest.evaluate(() => window.earlyCandidates.length)).toBeGreaterThan(0);
        await expect.poll(() => guest.evaluate(() => [...__hangout.av.pcs.values()][0]?.pc.connectionState), { timeout: 15000 }).toBe('connected');
        await expect.poll(() => guest.evaluate(() => document.querySelector('.tile:not([data-tile="me"]) video')?.videoWidth || 0), { timeout: 15000 }).toBeGreaterThan(0);
        expect(await guest.evaluate(() => [...__hangout.av.pcs.values()][0].pendingIce.length)).toBe(0);
        expect(await guest.evaluate(() => earlyCandidates.some((candidate) => appliedCandidates.includes(candidate)))).toBe(true);
    } finally { await Promise.all(contexts.map((context) => context.close())); }
});
