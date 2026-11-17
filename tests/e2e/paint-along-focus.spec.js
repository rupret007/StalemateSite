const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { test: base, expect, devices } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');

// The two-camera checks still use browser media tracks and the site's WebRTC
// connection. Generate the inputs inside WebKit so a host's fake capture
// device cannot crash when a second participant opens the camera preview.
function useSyntheticCapture() {
    navigator.mediaDevices.getUserMedia = async ({ audio, video }) => {
        const stream = new MediaStream();
        if (video) {
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 240;
            const surface = canvas.getContext('2d');
            const paint = () => {
                surface.fillStyle = '#252d2b';
                surface.fillRect(0, 0, 320, 240);
                surface.fillStyle = '#d4ad65';
                surface.fillRect((Date.now() / 40) % 160, 60, 140, 120);
            };
            paint();
            const [track] = canvas.captureStream(12).getVideoTracks();
            const timer = setInterval(() => {
                if (track.readyState === 'ended') clearInterval(timer);
                else paint();
            }, 83);
            stream.addTrack(track);
        }
        if (audio) {
            const context = new AudioContext();
            const destination = context.createMediaStreamDestination();
            const oscillator = context.createOscillator();
            const level = context.createGain();
            level.gain.value = 0.02;
            oscillator.connect(level).connect(destination);
            oscillator.start();
            await context.resume();
            const [track] = destination.stream.getAudioTracks();
            const timer = setInterval(() => {
                if (track.readyState !== 'ended') return;
                clearInterval(timer);
                void context.close();
            }, 1000);
            stream.addTrack(track);
        }
        return stream;
    };
}

// Use phone-sized media fixtures in the standard Chromium and WebKit suites.
const test = base.extend({
    launchOptions: [async ({ browserName, launchOptions }, use) => {
        if (browserName !== 'chromium') return use(launchOptions);
        await use({ ...launchOptions, args: [...(launchOptions.args || []),
            '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    }, { scope: 'worker' }],
    userAgent: async ({ browserName }, use) => {
        await use(devices[browserName === 'webkit' ? 'iPhone 13' : 'Pixel 5'].userAgent);
    },
    peerBrowser: async ({ browser, browserName, launchOptions }, use) => {
        if (browserName !== 'webkit') {
            await use(browser);
            return;
        }
        // Concurrent fake capture in one WebKit process crashes on Bobserver.
        // Use independent browsers like two phones, with real peer connections.
        const peer = await browser.browserType().launch(launchOptions);
        try {
            await use(peer);
        } finally {
            await peer.close();
        }
    }
});
test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    permissions: ['camera', 'microphone']
});

async function saveShot(page, filename) {
    const folder = process.env.PAINT_FOCUS_EVIDENCE;
    if (!folder || test.info().project.name !== 'chromium') return;
    await fs.mkdir(folder, { recursive: true });
    await page.screenshot({ path: path.join(folder, filename), animations: 'disabled' });
}

async function enter(page, name) {
    await page.locator('[data-name]').fill(name);
    await page.locator('[data-enter]').click();
    await expect(page.locator('[data-room]')).toBeVisible();
}

async function routeYouTube(context) {
    await context.route(/youtube\.com|ytimg|googlevideo/, route => route.abort());
    await context.route('https://www.youtube.com/iframe_api', route => route.fulfill({
        path: FAKE_YT, contentType: 'text/javascript'
    }));
}

async function openHost(context, origin) {
    await routeYouTube(context);
    const host = await context.newPage();
    const relay = hangoutRelayWsBase(origin, `paint-focus-${randomUUID()}`);
    await host.goto(`/r/45662413410ed051/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
    await enter(host, 'Host');
    return host;
}

async function paintInvite(context, origin) {
    const host = await openHost(context, origin);
    await host.locator('[data-bob-toggle]').click();
    await chooseEpisode(host);
    return host;
}

async function chooseEpisode(host) {
    const details = host.locator('[data-bob] details.episodes');
    if (!(await details.evaluate(element => element.open))) await details.locator('summary').click();
    await host.locator('[data-bob-ep="uj5FE70BcB0"]').click();
    await details.locator('summary').click();
    await expect(host.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
}

function inviteFor(host) {
    const invite = new URL(host.url());
    invite.searchParams.delete('preview');
    return invite;
}

test('invite, name, room, then media consent with denial, reconnect and rejoin', async ({ page, context, baseURL }) => {
    const host = await paintInvite(context, baseURL);
    const invite = inviteFor(host);
    // Use a separate browser context to exercise the guest's private admission and history.
    const guestContext = await context.browser().newContext({
        ...contextOptions(page),
        permissions: ['camera', 'microphone']
    });
    try {
        await routeYouTube(guestContext);
        await guestContext.addInitScript(() => {
            window.captureAttempts = 0;
            window.denyCapture = true;
            const capture = MediaDevices.prototype.getUserMedia;
            MediaDevices.prototype.getUserMedia = async function (constraints) {
                window.captureAttempts++;
                if (window.denyCapture) throw new DOMException('Permission denied', 'NotAllowedError');
                window.previewStream = await capture.call(this, constraints);
                return window.previewStream;
            };
        });
        const guest = await guestContext.newPage();
        const consent = guest.locator('[data-consent]');
        const camera = guest.locator('[data-consent-on]');
        const attempts = () => guest.evaluate(() => window.captureAttempts);

        await guest.goto(invite.href);
        await expect(guest.locator('[data-gate-title]')).toHaveText('You’re invited');
        await expect(guest.locator('[data-name]')).toBeVisible();
        await saveShot(guest, 'join.png');
        await expect(guest.locator('[data-check-btn]')).toBeHidden();
        await expect(guest.locator('[data-room]')).toBeHidden();
        await expect(consent).toBeHidden();
        await guest.locator('[data-enter]').click();
        await expect(guest.locator('[data-name]')).toBeFocused();
        await expect(consent).toBeHidden();
        expect(await attempts()).toBe(0);

        await enter(guest, 'Guest');
        await expect(guest.locator('[data-gate]')).toBeHidden();
        await expect(guest.locator('body')).toHaveClass(/bob-mode/);
        await expect(consent).toBeVisible();
        await saveShot(guest, 'consent.png');
        expect(await attempts()).toBe(0);
        await camera.click();
        await expect(consent).toHaveAttribute('data-state', 'denied');
        expect(await attempts()).toBe(1);
        await expect(guest.locator('[data-consent-error]')).toContainText('allow Camera and Microphone');
        await expect(camera).toHaveText('Try again');

        await guest.evaluate(() => { window.denyCapture = false; });
        await camera.click();
        await expect(consent).toHaveAttribute('data-state', 'preview');
        expect(await attempts()).toBe(2);
        expect(await guest.evaluate(() => window.__hangout.av.cam || window.__hangout.av.mic)).toBe(false);

        const oldSocket = await guest.evaluateHandle(() => window.__hangout.ws);
        await oldSocket.evaluate(socket => socket.close());
        await expect.poll(() => guest.evaluate(socket => window.__hangout.ws !== socket && window.__hangout.connected, oldSocket)).toBe(true);
        await expect(consent).toHaveAttribute('data-state', 'idle');
        expect(await guest.evaluate(() => window.previewStream.getTracks().map(track => track.readyState))).toEqual(['ended', 'ended']);
        expect(await attempts()).toBe(2);
        await camera.click();
        await expect(consent).toHaveAttribute('data-state', 'preview');
        await camera.click();
        await expect(consent).toBeHidden();
        await expect(guest.locator('[data-cam]')).toHaveText('Stop video');
        await expect(guest.locator('[data-mic]')).toHaveText('Mute mic');

        await guest.locator('.leave-room').click();
        await expect(guest).toHaveURL(/\/lobby\//);
        invite.searchParams.set('autojoin', '1');
        await guest.goto(invite.href);
        await expect(guest.locator('[data-name]')).toBeVisible();
        await expect(guest.locator('[data-room]')).toBeHidden();
        await expect(consent).toBeHidden();
        await enter(guest, 'Guest');
        await expect(consent).toBeVisible();
        expect(await attempts()).toBe(0);
    } finally {
        await guestContext.close();
    }
});

function contextOptions(page) {
    return { viewport: page.viewportSize(), hasTouch: true, isMobile: true, deviceScaleFactor: 1 };
}


async function joinWithCamera(page) {
    await page.bringToFront();
    const consent = page.locator('[data-consent]');
    await expect(consent).toBeVisible();
    await page.locator('[data-consent-on]').click();
    await expect(consent).toHaveAttribute('data-state', 'preview');
    await page.locator('[data-consent-on]').click();
    await expect(consent).toBeHidden();
}

async function joinCameraPair(host, guest) {
    await joinWithCamera(host);
    // Consent dismissal precedes WebRTC setup. Confirm the first camera and
    // mic have been negotiated before the guest turns on their own devices.
    await expect.poll(() => guest.evaluate(() => {
        const peers = [...window.__hangout.av.pcs.values()];
        return peers.some(({ pc, stream }) => pc.connectionState === 'connected'
            && pc.signalingState === 'stable'
            && stream.getVideoTracks().some(track => track.readyState === 'live')
            && stream.getAudioTracks().some(track => track.readyState === 'live'));
    })).toBe(true);
    await joinWithCamera(guest);
}

async function sharedPair(context, peerBrowser, origin, viewport, mode = 'paint') {
    const webkit = peerBrowser.browserType().name() === 'webkit';
    if (webkit) await context.addInitScript(useSyntheticCapture);
    const host = await openHost(context, origin);
    let invite;
    if (mode === 'paint') {
        await host.locator('[data-bob-toggle]').click();
        invite = inviteFor(host);
    } else {
        await host.locator('[data-watch-toggle]').click();
        await host.locator('[data-pick-yt="BtnyqIHTDMM"]').click();
        await expect(host.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
        await host.evaluate(() => {
            navigator.share = async data => { window.copiedInvite = data.url; };
            navigator.clipboard.writeText = async url => { window.copiedInvite = url; };
        });
        await host.locator('[data-copy]').click();
        invite = new URL(await host.evaluate(() => window.copiedInvite));
        expect(invite.searchParams.get('activity')).toBe('watch');
        expect(invite.searchParams.has('preview')).toBe(false);
    }
    const guestContext = await peerBrowser.newContext({
        ...contextOptions(host), viewport, permissions: ['camera', 'microphone']
    });
    try {
        if (webkit) await guestContext.addInitScript(useSyntheticCapture);
        await routeYouTube(guestContext);
        const guest = await guestContext.newPage();
        await guest.goto(invite.href);
        await expect(guest.locator('[data-consent]')).toBeHidden();
        await enter(guest, 'Guest');
        await expect.poll(() => guest.evaluate(() => window.__hangout.snapshotDone)).toBe(true);
        if (mode === 'paint') await chooseEpisode(host);
        await expect(guest.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
        return { host, guest, guestContext };
    } catch (error) {
        await guestContext.close();
        throw error;
    }
}

async function expectPhoneStage(page) {
    const viewport = page.viewportSize();
    const stage = page.locator('.watch .screen');
    const otherSurfaces = page.locator('[data-tiles], .chat:visible, .callbar');
    await expect(stage.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
    const box = await stage.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(viewport.width - 16);
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.05);
    await expect(stage).toBeInViewport({ ratio: 1 });
    for (const surface of await otherSurfaces.all()) {
        const other = await surface.boundingBox();
        expect(other.y).toBeGreaterThanOrEqual(box.y + box.height);
        expect(box.width * box.height).toBeGreaterThan(other.width * other.height);
    }
    const unobstructed = await stage.evaluate(element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return [[0.1, 0.1], [0.9, 0.1], [0.5, 0.5], [0.1, 0.9], [0.9, 0.9]]
            .every(([left, top]) => element.contains(document.elementFromPoint(x + width * left, y + height * top)));
    });
    expect(unobstructed).toBe(true);
}

test('the Paint Along stage stays fully visible above two live tiles and open chat at both phone sizes', async ({ context, peerBrowser, baseURL, viewport }) => {
    test.setTimeout(60000);
    const { host, guest, guestContext } = await sharedPair(context, peerBrowser, baseURL, viewport);
    try {
        await joinCameraPair(host, guest);
        for (const page of [host, guest]) {
            const tiles = page.locator('[data-tiles] .tile');
            await expect(tiles).toHaveCount(2);
            await expect.poll(() => tiles.locator('video').evaluateAll(videos =>
                videos.filter(video => video.videoWidth > 0).length
            ), { timeout: 20000 }).toBe(2);
        }
        for (const size of [viewport, { width: 375, height: 667 }]) {
            await host.setViewportSize(size);
            await expectPhoneStage(host);
            await host.locator('[data-chat-toggle]').click();
            await expect(host.locator('.chat')).toBeVisible();
            await expectPhoneStage(host);
            if (size.width === 390) await saveShot(host, 'paint-along-two-tiles.png');
            await host.locator('[data-chat-toggle]').click();
        }
    } finally {
        await guestContext.close();
    }
});

test('a guest pauses, plays and seeks for everyone, including a late join', async ({ context, peerBrowser, baseURL, viewport }) => {
    const { host, guest, guestContext } = await sharedPair(context, peerBrowser, baseURL, viewport);
    try {
        const pages = [host, guest];
        const expectPlayback = async (state, participants = pages) => {
            for (const page of participants) {
                await expect(page.locator('[data-fake-yt]')).toHaveAttribute('data-state', state);
            }
        };
        await expectPlayback('playing');
        await guest.locator('[data-bob-hold]').click();
        await expectPlayback('paused');
        await guest.evaluate(() => window.__ytLog[0].seekTo(120));
        for (const page of pages) {
            await expect.poll(() => page.evaluate(() => window.__ytLog[0].getCurrentTime())).toBeCloseTo(120, 0);
        }
        await guest.locator('[data-bob-hold]').click();
        await expectPlayback('playing');

        const late = await guestContext.newPage();
        await late.goto(inviteFor(host).href);
        await enter(late, 'Late painter');
        await expect.poll(() => late.evaluate(() => window.__hangout.snapshotDone)).toBe(true);
        await expectPlayback('playing', [host, guest, late]);
        await expect.poll(() => late.evaluate(() => window.__ytLog[0].getCurrentTime())).toBeGreaterThanOrEqual(120);
        await guest.locator('[data-bob-hold]').click();
        await expectPlayback('paused', [host, guest, late]);
    } finally {
        await guestContext.close();
    }
});

test('music, video sound, game effects and live microphone remain independent', async ({ context, peerBrowser, baseURL, viewport }) => {
    const { host, guest, guestContext } = await sharedPair(context, peerBrowser, baseURL, viewport);
    try {
        await joinCameraPair(host, guest);
        const videoSound = host.locator('[data-soundtrack]');
        const music = host.locator('[data-music-toggle]');
        const micState = () => host.evaluate(() => window.__hangout.av.stream.getAudioTracks()
            .some(track => track.enabled && track.readyState === 'live'));
        const remoteMic = () => guest.locator('[data-tiles] .tile:not([data-tile="me"]) video').evaluate(video =>
            video.srcObject?.getAudioTracks().some(track => track.enabled && track.readyState === 'live'));
        await expect.poll(remoteMic).toBe(true);
        const videoIsMuted = () => host.evaluate(() => window.__ytLog[0].isMuted());
        await host.evaluate(() => localStorage.setItem('turdsuite_muted', '1'));
        await host.locator('[data-more]').click();
        await expect(music).toHaveText('Music on');
        await expect(music).toHaveAttribute('aria-pressed', 'true');
        await expect(music).toHaveCSS('background-color', 'rgb(31, 122, 69)');
        await music.click();
        await host.locator('[data-more]').click();
        await expect(music).toHaveText('Music off');
        await expect(music).toHaveAttribute('aria-pressed', 'false');
        await expect(music).toHaveCSS('background-color', 'rgb(179, 38, 30)');
        expect(await videoIsMuted()).toBe(false);
        expect(await micState()).toBe(true);
        expect(await remoteMic()).toBe(true);

        await videoSound.click();
        await host.locator('[data-soundtrack-mute]').click();
        await expect(videoSound).toHaveText('Video muted');
        await expect(videoSound).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(videoIsMuted).toBe(true);
        expect(await guest.evaluate(() => window.__ytLog[0].isMuted())).toBe(false);
        expect(await micState()).toBe(true);
        expect(await remoteMic()).toBe(true);

        await host.locator('[data-soundtrack-mute]').click();
        await expect.poll(videoIsMuted).toBe(false);
        await expect(videoSound).toHaveAttribute('aria-pressed', 'true');
        expect(await host.evaluate(() => localStorage.getItem('stalemate.music'))).toBe('off');
        expect(await host.evaluate(() => localStorage.getItem('turdsuite_muted'))).toBe('1');
    } finally {
        await guestContext.close();
    }
});

async function expectTouchTargets(root) {
    const small = await root.locator('button:visible, a[href]:visible, input:visible, select:visible, summary:visible')
        .evaluateAll(elements => elements.flatMap(element => {
            const target = element.matches('input[type="checkbox"]') ? element.closest('label') || element : element;
            const { width, height } = target.getBoundingClientRect();
            const label = element.getAttribute('aria-label') || element.textContent.trim() || element.outerHTML.split('>')[0];
            return width < 48 || height < 48 ? [{ label, width, height }] : [];
        }));
    expect(small).toEqual([]);
}

test('the phone layout gives camera consent priority and keeps labeled 48px controls', async ({ page, context, peerBrowser, baseURL, viewport }) => {
    test.setTimeout(60000);
    const { host, guest, guestContext } = await sharedPair(context, peerBrowser, baseURL, viewport);
    try {
        await page.goto(inviteFor(host).href);
        await expectTouchTargets(page.locator('body'));
        const consent = host.locator('[data-consent]');
        const camera = consent.locator('[data-consent-on]');
        await expect(camera).toContainText('Turn on camera');
        await expect(camera).toHaveCSS('background-color', 'rgb(31, 122, 69)');
        expect((await camera.boundingBox()).width).toBeGreaterThan((await consent.locator('[data-consent-skip]').boundingBox()).width);
        await expectTouchTargets(consent);
        await joinCameraPair(host, guest);
        const tiles = host.locator('[data-tiles] .tile');
        await expect(tiles).toHaveCount(2);
        const [remote, local] = await Promise.all([tiles.first().boundingBox(), tiles.last().boundingBox()]);
        expect(remote.y).toBe(local.y);
        expect(remote.x + remote.width).toBeLessThanOrEqual(local.x);
        expect(remote.width).toBeGreaterThan(local.width);
        await expect(tiles.locator('video').first()).toHaveCSS('object-fit', 'contain');
        await expect(host.locator('[data-canvas]')).toBeHidden();
        await host.locator('[data-chat-toggle]').click();
        await expect(host.locator('.chat')).toBeVisible();
        await expectTouchTargets(host.locator('body'));
        const dock = host.locator('.callbar');
        const dockBox = await dock.boundingBox();
        expect(dockBox.y + dockBox.height).toBe(viewport.height);
        for (const button of await dock.locator('.callbar-main .btn').all()) {
            expect((await button.innerText()).trim()).not.toBe('');
        }
        await host.locator('[data-more]').click();
        await expectTouchTargets(dock);
        await host.locator('[data-more]').click();
        await host.locator('[data-soundtrack]').click();
        await expectTouchTargets(dock);
    } finally {
        await guestContext.close();
    }
});

test('Watch a Movie Together uses the shared phone stage and keeps video selection with the host', async ({ context, peerBrowser, baseURL, viewport }) => {
    test.setTimeout(60000);
    const { host, guest, guestContext } = await sharedPair(context, peerBrowser, baseURL, viewport, 'watch');
    try {
        for (const page of [host, guest]) {
            await expect(page.locator('body')).toHaveAttribute('data-shared-layout', 'watch');
            await expect(page.locator('[data-bob]')).toBeHidden();
            await expect(page.locator('[data-canvas]')).toBeHidden();
        }
        await joinCameraPair(host, guest);
        await expect(host.locator('[data-load]')).toBeVisible();
        await expect(guest.locator('[data-load]')).toBeHidden();
        await expect(host.locator('[data-bob-toggle]')).toBeVisible();
        await expect(guest.locator('[data-bob-toggle]')).toBeHidden();
        await guest.locator('[data-bob-toggle]').evaluate(button => button.click());
        await expect(guest.locator('body')).toHaveAttribute('data-shared-layout', 'watch');
        await expect(guest.locator('[data-bob]')).toBeHidden();
        await expect(guest.locator('[data-picks]')).toBeHidden();
        const tiles = guest.locator('[data-tiles] .tile');
        await expect(tiles).toHaveCount(2);
        await expect.poll(() => tiles.locator('video').evaluateAll(videos =>
            videos.filter(video => video.videoWidth > 0).length
        ), { timeout: 20000 }).toBe(2);
        for (const size of [viewport, { width: 375, height: 667 }]) {
            await guest.setViewportSize(size);
            await guest.locator('[data-chat-toggle]').click();
            await expectPhoneStage(guest);
            await expectTouchTargets(guest.locator('body'));
            if (size.width === 390) await saveShot(guest, 'watch-a-movie-together.png');
            await guest.locator('[data-chat-toggle]').click();
        }

        await guest.evaluate(() => window.__ytLog[0].pauseVideo());
        for (const [person, page] of [['host', host], ['guest', guest]]) {
            await expect(page.locator('[data-fake-yt]'), `${person} receives guest pause`).toHaveAttribute('data-state', 'paused');
        }
        await guest.evaluate(() => window.__ytLog[0].seekTo(42));
        await expect.poll(() => host.evaluate(() => window.__ytLog[0].getCurrentTime())).toBeCloseTo(42, 0);
        await guest.evaluate(() => window.__ytLog[0].playVideo());
        for (const page of [host, guest]) {
            await expect(page.locator('[data-fake-yt]')).toHaveAttribute('data-state', 'playing');
        }
    } finally {
        await guestContext.close();
    }
});
