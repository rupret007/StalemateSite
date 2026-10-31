const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const KEY = 'local-preview-key-0001';
test.use({
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }
});

let testOrigin;
test.beforeAll(async ({ baseURL }) => { testOrigin = baseURL; });

async function openCheck(page, { delayMedia = false } = {}) {
    await page.addInitScript(({ delayMedia }) => {
        window.checkStreams = [];
        window.checkConnections = [];
        const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (constraints) => {
            const stream = await getUserMedia(constraints);
            window.checkStreams.push(stream);
            if (delayMedia) await new Promise((resolve) => { window.releaseCheckMedia = resolve; });
            return stream;
        };
        // Keep the network probe pending so these tests cover closing during ICE gathering.
        window.RTCPeerConnection = class {
            constructor() { this.closed = false; window.checkConnections.push(this); }
            createDataChannel() {}
            async createOffer() { return {}; }
            async setLocalDescription() {}
            close() { this.closed = true; }
        };
    }, { delayMedia });
    await page.goto(`/r/45662413410ed051/?preview=${KEY}&relay=${encodeURIComponent(hangoutRelayWsBase(testOrigin))}`);
    await page.click('[data-check-btn]');
    await expect.poll(() => page.evaluate(() => window.checkStreams.length)).toBe(1);
}

async function tracksEnded(page) {
    await expect.poll(() => page.evaluate(() => window.checkStreams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBe(true);
}

test('closing the check during network probing immediately releases camera and mic', async ({ page }) => {
    await openCheck(page);
    await expect.poll(() => page.evaluate(() => window.checkConnections.length)).toBe(1);
    await page.click('[data-check-done]');
    await expect(page.locator('[data-check]')).toBeHidden();
    await tracksEnded(page);
    expect(await page.evaluate(() => window.checkConnections.every((pc) => pc.closed))).toBe(true);
    expect(await page.locator('[data-check-video]').evaluate((video) => video.srcObject)).toBeNull();
});

test('closing while camera permission is pending stops the eventual stream', async ({ page }) => {
    await openCheck(page, { delayMedia: true });
    await page.click('[data-check-done]');
    await expect(page.locator('[data-check]')).toBeHidden();
    await page.evaluate(() => window.releaseCheckMedia());
    await tracksEnded(page);
    expect(await page.evaluate(() => window.checkConnections.length)).toBe(0);
    expect(await page.locator('[data-check-video]').evaluate((video) => video.srcObject)).toBeNull();
});

test('joining the room closes the private preview and releases both devices', async ({ page }) => {
    await openCheck(page);
    await page.fill('[data-name]', 'Preview tester');
    await page.click('[data-enter]');
    await expect(page.locator('[data-room]')).toBeVisible();
    await tracksEnded(page);
    await expect(page.locator('[data-check]')).toBeHidden();
    expect(await page.evaluate(() => ({ mic: window.__hangout.av.mic, cam: window.__hangout.av.cam }))).toEqual({ mic: false, cam: false });
});

test('restarting the check releases the previous preview and closes the latest one', async ({ page }) => {
    await openCheck(page);
    await page.click('[data-check-btn]');
    await expect.poll(() => page.evaluate(() => window.checkStreams.length)).toBe(2);
    await expect.poll(() => page.evaluate(() => window.checkStreams[0].getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
    expect(await page.evaluate(() => window.checkStreams[1].getTracks().every((track) => track.readyState === 'live'))).toBe(true);
    await page.click('[data-check-done]');
    await tracksEnded(page);
    expect(await page.evaluate(() => window.checkConnections.every((pc) => pc.closed))).toBe(true);
});
