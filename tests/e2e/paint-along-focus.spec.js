const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');

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

async function paintInvite(context, origin, { selectEpisode = true } = {}) {
    await routeYouTube(context);
    const host = await context.newPage();
    const relay = hangoutRelayWsBase(origin, `paint-focus-${randomUUID()}`);
    await host.goto(`/r/45662413410ed051/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
    await enter(host, 'Host');
    await host.locator('[data-bob-toggle]').click();
    if (selectEpisode) await chooseEpisode(host);
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
    const consent = page.locator('[data-consent]');
    await expect(consent).toBeVisible();
    await page.locator('[data-consent-on]').click();
    await expect(consent).toHaveAttribute('data-state', 'preview');
    await page.locator('[data-consent-on]').click();
    await expect(consent).toBeHidden();
}

async function paintPair(context, origin, viewport) {
    const host = await paintInvite(context, origin, { selectEpisode: false });
    const guestContext = await context.browser().newContext({
        ...contextOptions(host), viewport, permissions: ['camera', 'microphone']
    });
    try {
        await routeYouTube(guestContext);
        const guest = await guestContext.newPage();
        await guest.goto(inviteFor(host).href);
        await enter(guest, 'Guest');
        await expect.poll(() => guest.evaluate(() => window.__hangout.snapshotDone)).toBe(true);
        await chooseEpisode(host);
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

test('the Paint Along stage stays fully visible above two live tiles and open chat at both phone sizes', async ({ context, baseURL, viewport }) => {
    test.setTimeout(60000);
    const { host, guest, guestContext } = await paintPair(context, baseURL, viewport);
    try {
        await joinWithCamera(host);
        await joinWithCamera(guest);
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
            await host.locator('[data-chat-toggle]').click();
        }
    } finally {
        await guestContext.close();
    }
});
