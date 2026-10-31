const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const KEY = 'local-preview-key-0001';
test.use({
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }
});

let testOrigin;
test.beforeAll(async ({ baseURL }) => { testOrigin = baseURL; });

async function join(page) {
    await page.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
    await page.goto(`/r/45662413410ed051/?preview=${KEY}&relay=${encodeURIComponent(hangoutRelayWsBase(testOrigin))}`);
    await page.fill('[data-name]', 'Artist');
    await page.click('[data-enter]');
    await expect(page.locator('[data-room]')).toBeVisible();
    await page.evaluate(() => {
        navigator.mediaDevices.getDisplayMedia = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 640; canvas.height = 480;
            canvas.getContext('2d').fillRect(0, 0, 640, 480);
            window.testDisplayStream = canvas.captureStream(8);
            return window.testDisplayStream;
        };
    });
}

async function enable(page, kind) {
    await page.click(`[data-${kind}]`);
    await page.click('[data-ask-yes]');
    await expect.poll(() => page.evaluate((key) => window.__hangout.av[key], kind)).toBe(true);
}

test('switching from screen share to the art camera ends screen sharing', async ({ page }) => {
    await join(page);
    await page.click('[data-share]');
    await expect(page.locator('[data-share]')).toHaveText('Stop sharing');
    await page.click('[data-canvas-cam]');
    await page.click('[data-ask-yes]');
    await expect(page.locator('[data-canvas-cam]')).toHaveText('Stop showing my canvas');
    await expect(page.locator('[data-share]')).toHaveText('Share screen');
    expect(await page.evaluate(() => ({
        screen: window.__hangout.av.screen,
        display: window.testDisplayStream.getVideoTracks()[0].readyState,
        camera: window.__hangout.av.rawCam.readyState,
        canvas: window.__hangout.av.canvas
    }))).toEqual({ screen: null, display: 'ended', camera: 'live', canvas: true });
});

test('screen sharing temporarily replaces the art camera and restores it when stopped', async ({ page }) => {
    await join(page);
    await page.click('[data-canvas-cam]');
    await page.click('[data-ask-yes]');
    await expect(page.locator('[data-canvas-cam]')).toHaveText('Stop showing my canvas');
    await page.click('[data-share]');
    await expect(page.locator('[data-share]')).toHaveText('Stop sharing');
    expect(await page.evaluate(() => window.__hangout.av.canvas)).toBe(false);
    await page.click('[data-lock]');
    await expect(page.locator('[data-lock]')).toHaveText('Unlock faces');
    await page.click('[data-share]');
    await expect(page.locator('[data-share]')).toHaveText('Share screen');
    await expect.poll(() => page.evaluate(() => ({
        cam: window.__hangout.av.cam,
        canvas: window.__hangout.av.canvas,
        track: window.__hangout.av.rawCam && window.__hangout.av.rawCam.readyState
    }))).toEqual({ cam: true, canvas: true, track: 'live' });
    await expect(page.locator('[data-ask]')).not.toBeVisible();
});

test('turning on the camera during screen share replaces the display track', async ({ page }) => {
    await join(page);
    await page.click('[data-share]');
    await expect(page.locator('[data-share]')).toHaveText('Stop sharing');
    await enable(page, 'cam');
    await expect(page.locator('[data-cam]')).toHaveText('Turn off my camera');
    await expect(page.locator('[data-share]')).toHaveText('Share screen');
    expect(await page.evaluate(() => window.testDisplayStream.getVideoTracks()[0].readyState)).toBe('ended');
    expect(await page.evaluate(() => window.__hangout.av.rawCam.readyState)).toBe('live');
});

for (const kind of ['cam', 'mic']) {
    test(`leaving the call cancels a pending ${kind} permission request`, async ({ page }) => {
        await join(page);
        await enable(page, kind === 'cam' ? 'mic' : 'cam');
        await page.evaluate((pendingKind) => {
            const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia = async (options) => {
                const stream = await getUserMedia(options);
                if (options[pendingKind === 'cam' ? 'video' : 'audio']) {
                    window.testPendingStream = stream;
                    await new Promise((resolve) => { window.testReleaseCapture = resolve; });
                }
                return stream;
            };
        }, kind);
        await page.click(`[data-${kind}]`);
        await page.click('[data-ask-yes]');
        await expect.poll(() => page.evaluate(() => Boolean(window.testReleaseCapture))).toBe(true);
        await page.click('[data-hangup]');
        await page.evaluate(() => window.testReleaseCapture());
        await expect.poll(() => page.evaluate(() => window.testPendingStream.getTracks().map((track) => track.readyState))).toEqual(['ended']);
        expect(await page.evaluate(() => ({ cam: window.__hangout.av.cam, mic: window.__hangout.av.mic }))).toEqual({ cam: false, mic: false });
        await expect(page.locator('[data-hangup]')).toBeHidden();
    });
}

test('turning all cameras off also cancels an outstanding camera permission request', async ({ page }) => {
    await join(page);
    await enable(page, 'mic');
    await page.evaluate(() => {
        const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (options) => {
            const stream = await getUserMedia(options);
            window.testPendingStream = stream;
            await new Promise((resolve) => { window.testReleaseCapture = resolve; });
            return stream;
        };
    });
    await page.click('[data-cam]');
    await page.click('[data-ask-yes]');
    await expect.poll(() => page.evaluate(() => Boolean(window.testReleaseCapture))).toBe(true);
    await page.click('[data-all-cams-off]');
    await expect(page.locator('[data-status]')).toContainText('camera off');
    await page.evaluate(() => window.testReleaseCapture());
    await expect.poll(() => page.evaluate(() => window.testPendingStream.getVideoTracks()[0].readyState)).toBe('ended');
    expect(await page.evaluate(() => ({ cam: window.__hangout.av.cam, mic: window.__hangout.av.mic }))).toEqual({ cam: false, mic: true });
});

for (const change of ['camera device', 'music mode']) {
    test(`leaving the call cancels media replacement for ${change}`, async ({ page }) => {
        await join(page);
        await enable(page, change === 'camera device' ? 'cam' : 'mic');
        await page.evaluate(() => {
            const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia = async (options) => {
                const stream = await getUserMedia(options);
                window.testPendingStream = stream;
                await new Promise((resolve) => { window.testReleaseCapture = resolve; });
                return stream;
            };
        });
        await page.click('[data-settings]');
        await expect(page.locator('[data-settings-dlg]')).toBeVisible();
        if (change === 'camera device') await page.locator('[data-dev-cam]').dispatchEvent('change');
        else await page.check('[data-music]');
        await expect.poll(() => page.evaluate(() => Boolean(window.testReleaseCapture))).toBe(true);
        await page.click('[data-settings-close]');
        await page.click('[data-hangup]');
        await page.evaluate(() => window.testReleaseCapture());
        await expect.poll(() => page.evaluate(() => window.testPendingStream.getTracks().map((track) => track.readyState))).toEqual(['ended']);
        expect(await page.evaluate(() => ({ cam: window.__hangout.av.cam, mic: window.__hangout.av.mic, stream: window.__hangout.av.stream }))).toEqual({ cam: false, mic: false, stream: null });
    });
}
