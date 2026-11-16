// Records whether private Hang Out exposes a room-music mute alongside a live call on a phone.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const SLUG = '45662413410ed051';
const KEY = 'local-preview-key-0001';
const PHONE = {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
};

test.use({
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] }
});

let testOrigin;
test.beforeAll(async ({ baseURL }) => { testOrigin = baseURL; });
const roomUrl = () => `/r/${SLUG}/?preview=${KEY}&relay=${encodeURIComponent(hangoutRelayWsBase(testOrigin))}`;

async function join(page, url, name) {
    await page.goto(url);
    await page.fill('[data-name]', name);
    await tapVisible(page, page.locator('[data-enter]'));
    await expect(page.locator('[data-room]')).toBeVisible();
}

async function turnCamera(page) {
    await tapVisible(page, page.locator('[data-cam]'));
    await tapVisible(page, page.locator('[data-ask-yes]'));
    await expect(page.locator('[data-cam]')).toHaveText('Turn off my camera');
}

async function turnMic(page) {
    await tapVisible(page, page.locator('[data-mic]'));
    await tapVisible(page, page.locator('[data-ask-yes]'));
    await expect(page.locator('[data-mic]')).toHaveText('Mute my mic');
}

async function tapVisible(page, locator) {
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeVisible();
    const point = await locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2,
            fits: r.width >= 44 && r.height >= 44 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
    });
    expect(point.fits, 'control must be fully visible in the 390x844 viewport').toBe(true);
    await page.touchscreen.tap(point.x, point.y);
}

test('390x844 private Hang Out call has no room-music mute control', async ({ browser }) => {
    test.skip(test.info().project.name !== 'chromium', 'Chromium project owns this check');
    test.setTimeout(90000);
    const contexts = [];
    try {
        const makePage = async () => {
            const context = await browser.newContext({ ...PHONE, permissions: ['camera', 'microphone'] });
            contexts.push(context);
            return context.newPage();
        };
        const host = await makePage();
        await join(host, roomUrl(), 'Alex');
        const guest = await makePage();
        await join(guest, host.url(), 'Blair');
        for (const page of [host, guest]) {
            await turnCamera(page);
            await turnMic(page);
            await expect(page.locator('[data-faces-play]')).toBeVisible({ timeout: 15000 });
            await tapVisible(page, page.locator('[data-faces-play]'));
        }
        const remoteFacesPlaying = (page) => page.evaluate(() => {
            const video = document.querySelector('[data-tiles] .tile:not([data-tile="me"]) video');
            return Boolean(video && !video.paused && video.videoWidth > 0);
        });
        await expect.poll(() => remoteFacesPlaying(host), { timeout: 15000 }).toBe(true);
        await expect.poll(() => remoteFacesPlaying(guest), { timeout: 15000 }).toBe(true);

        const song = host.locator('[data-pick-file="manic"]');
        await tapVisible(host, song);
        await expect.poll(() => host.evaluate(() => {
            const video = document.querySelector('[data-file]');
            return Boolean(video && !video.paused && video.currentTime > 0);
        }), { timeout: 15000 }).toBe(true);

        // The UI has music sources and a Music mode setting, but no dedicated room playback mute.
        // Music mode only changes microphone processing; do not treat it as a music player toggle.
        const ui = await host.evaluate(() => ({
            sourceChoices: [...document.querySelectorAll('[data-pick-file], [data-pick-yt]')].length,
            musicMode: Boolean(document.querySelector('[data-music]')),
            muteControls: [...document.querySelectorAll('button, input, [role="button"]')]
                .filter((el) => /music.*mute|mute.*music|music off|music on/i.test(`${el.textContent} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`))
                .length,
            effectsMuteControls: [...document.querySelectorAll('button, input, [role="button"]')]
                .filter((el) => /(?:sound|game|audio|effects?).*(?:mute|off)|(?:mute|off).*(?:sound|game|audio|effects?)/i.test(`${el.textContent} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`))
                .length,
            remoteAudio: [...document.querySelectorAll('[data-tiles] .tile:not([data-tile="me"]) video')]
                .map((audio) => ({ muted: audio.muted, paused: audio.paused }))
        }));
        expect(ui.sourceChoices).toBeGreaterThan(0);
        expect(ui.musicMode).toBe(true);
        expect(ui.muteControls, 'room has no dedicated music playback mute control').toBe(0);
        expect(ui.effectsMuteControls, 'room has no separate game or sound-effects mute control').toBe(0);
        expect(await host.evaluate(() => window.__hangout.av.stream.getAudioTracks().every((track) => track.enabled))).toBe(true);
        expect(ui.remoteAudio.every((audio) => !audio.muted)).toBe(true);
    } finally {
        await Promise.all(contexts.map((context) => context.close()));
    }
});
