const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const KEY = 'local-preview-key-0001';
test.use({
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] }
});

let testOrigin;
test.beforeAll(async ({ baseURL }) => { testOrigin = baseURL; });

async function join(page, url, name) {
    // Supply a steady, audible mic signal so the actual Web Audio analyser and
    // peer audio transport can drive the speaker indicator deterministically.
    await page.addInitScript(() => {
        const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        window.speakerSources = [];
        navigator.mediaDevices.getUserMedia = async (constraints) => {
            const stream = await getUserMedia(constraints);
            if (constraints.audio) {
                stream.getAudioTracks().forEach((track) => { stream.removeTrack(track); track.stop(); });
                const ac = new AudioContext();
                const oscillator = ac.createOscillator();
                const gain = ac.createGain();
                const destination = ac.createMediaStreamDestination();
                gain.gain.value = 0.25;
                oscillator.connect(gain).connect(destination);
                oscillator.start();
                await ac.resume();
                stream.addTrack(destination.stream.getAudioTracks()[0]);
                window.speakerSources.push({ ac, oscillator });
            }
            return stream;
        };
    });
    await page.goto(url);
    await page.fill('[data-name]', name);
    await page.click('[data-enter]');
    await expect(page.locator('[data-room]')).toBeVisible();
}

async function turnOn(page, kind) {
    await page.click(`[data-${kind}]`);
    await page.click('[data-ask-yes]');
    await expect(page.locator(`[data-${kind}]`)).toHaveAttribute('aria-pressed', 'true');
}

const roomUrl = () => `/r/45662413410ed051/?preview=${KEY}&relay=${encodeURIComponent(hangoutRelayWsBase(testOrigin))}`;

test('camera first, then mic: speaker detection starts and follows a new mic track after muting', async ({ page }) => {
    await join(page, roomUrl(), 'Speaker');
    await turnOn(page, 'cam');
    expect(await page.evaluate(() => window.__hangout.av.ac !== null)).toBe(true);
    expect(await page.evaluate(() => window.__hangout.av.meters.size)).toBe(0);

    await turnOn(page, 'mic');
    const tile = page.locator('[data-tile="me"]');
    await expect(tile).toHaveClass(/is-talking/);
    await expect.poll(() => page.evaluate(() => window.__hangout.av.speaker.id)).toBe('me');
    const firstTrack = await page.evaluate(() => window.__hangout.av.stream.getAudioTracks()[0].id);

    await page.click('[data-mic]');
    await expect(tile).not.toHaveClass(/is-talking/);
    await page.click('[data-mic]');
    await expect(tile).toHaveClass(/is-talking/);
    expect(await page.evaluate(() => window.__hangout.av.stream.getAudioTracks()[0].id)).not.toBe(firstTrack);
});

test('audio received before the local audio context starts gets a speaker meter', async ({ browser, page }) => {
    await join(page, roomUrl(), 'Speaker');
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
    try {
        const guest = await context.newPage();
        await join(guest, page.url(), 'Listener');
        await expect(guest.locator('[data-peers]')).toContainText('2 here');
        await turnOn(page, 'mic');
        await expect.poll(() => guest.evaluate(() => [...window.__hangout.av.pcs.values()].some((entry) => entry.stream.getAudioTracks().length > 0)), { timeout: 15000 }).toBe(true);
        expect(await guest.evaluate(() => window.__hangout.av.ac)).toBeNull();
        expect(await guest.evaluate(() => window.__hangout.av.meters.size)).toBe(0);

        await turnOn(guest, 'cam');
        await expect(guest.locator('.tile:not([data-tile="me"])')).toHaveClass(/is-talking/);
        await expect.poll(() => guest.evaluate(() => window.__hangout.av.speaker.id)).toBe(await page.evaluate(() => window.__hangout.myId));
    } finally {
        await context.close();
    }
});
