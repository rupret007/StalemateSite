const path = require('node:path');
const fs = require('node:fs/promises');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const SLUG = '45662413410ed051';
const KEY = 'local-preview-key-0001';
const FAKE_YT = path.join(__dirname, 'support/fake-youtube.js');
const roomUrl = (origin) => `/r/${SLUG}/?preview=${KEY}&relay=${encodeURIComponent(hangoutRelayWsBase(origin))}`;

test.skip(({ browserName }) => browserName !== 'chromium', 'Fake media two-person layout coverage runs in Chromium');
test.use({ permissions: ['camera', 'microphone'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

async function pageFor(browser, origin) {
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
    await context.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
    await context.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ path: FAKE_YT, contentType: 'text/javascript' }));
    const page = await context.newPage();
    await page.goto(roomUrl(origin));
    return { page, context };
}

async function joinTwo(browser, origin, viewport, screenshots) {
    const hostCtx = await pageFor(browser, origin);
    await hostCtx.page.setViewportSize(viewport);
    await hostCtx.page.fill('[data-name]', 'Host');
    await hostCtx.page.click('[data-enter]');
    await expect(hostCtx.page.locator('[data-room]')).toBeVisible();
    const invite = hostCtx.page.url();
    const guestCtx = await pageFor(browser, origin);
    await guestCtx.page.setViewportSize(viewport);
    await guestCtx.page.goto(invite);
    await guestCtx.page.fill('[data-name]', 'Guest');
    await guestCtx.page.click('[data-enter]');
    await expect(hostCtx.page.locator('[data-peers]')).toContainText('2 here');
    await hostCtx.page.locator('[data-bob-toggle]').click();
    await guestCtx.page.locator('[data-bob-toggle]').click();
    await hostCtx.page.locator('[data-cam]').click();
    await guestCtx.page.locator('[data-cam]').click();
    await expect(hostCtx.page.locator('[data-tile="me"]')).toBeVisible();
    await expect(hostCtx.page.locator('.tile:not([data-tile="me"])')).toBeVisible();
    await expect(guestCtx.page.locator('.tile:not([data-tile="me"])')).toBeVisible();
    const page = hostCtx.page;
    if (viewport.width < 500) {
        const stage = page.locator('.watch .screen');
        const stageBox = await stage.boundingBox();
        expect(stageBox.x).toBeGreaterThanOrEqual(0);
        expect(stageBox.x + stageBox.width).toBeLessThanOrEqual(viewport.width + 1);
        const tileBox = await page.locator('.tiles').boundingBox();
        const barBox = await page.locator('.callbar').boundingBox();
        expect(stageBox.y + stageBox.height).toBeLessThanOrEqual(tileBox.y + 1);
        expect(tileBox.y + tileBox.height).toBeLessThanOrEqual(barBox.y + 1);
        await page.screenshot({ path: `${screenshots}/phone-stage.png`, fullPage: true });
        await page.locator('[data-chat-toggle]').click();
        await expect(page.locator('.chat')).toBeHidden();
        await page.locator('[data-chat-toggle]').click();
        await page.screenshot({ path: `${screenshots}/phone-chat-drawer.png`, fullPage: true });
    } else {
        const boxes = await Promise.all(['.watch', '.call', '.chat'].map((s) => page.locator(s).boundingBox()));
        expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(boxes[1].x + 1);
        expect(boxes[1].x + boxes[1].width).toBeLessThanOrEqual(boxes[2].x + 1);
        const stageBox = await page.locator('.watch .screen').boundingBox();
        const tileBox = await page.locator('.tiles').boundingBox();
        const barBox = await page.locator('.callbar').boundingBox();
        expect(stageBox.y + stageBox.height).toBeLessThanOrEqual(boxes[0].y + boxes[0].height);
        expect(tileBox.y + tileBox.height).toBeLessThanOrEqual(barBox.y + 1);
        await page.screenshot({ path: `${screenshots}/desktop-webex.png`, fullPage: true });
    }
    const controls = page.locator('.callbar button:visible');
    for (const button of await controls.all()) {
        const box = await button.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(48);
        expect((await button.innerText()).trim()).not.toBe('');
    }
    await hostCtx.context.close();
    await guestCtx.context.close();
}

test('Paint Along stage, participant strip, chat and labeled controls fit phone and desktop', async ({ browser, baseURL }) => {
    const screenshots = path.resolve('test-results/ux-screens');
    await fs.mkdir(screenshots, { recursive: true });
    // Consent capture stays opt-in; capture the pre-join name step as the consent-entry reference.
    const consent = await pageFor(browser, baseURL);
    await consent.page.setViewportSize({ width: 390, height: 844 });
    await consent.page.screenshot({ path: `${screenshots}/phone-join-consent.png`, fullPage: true });
    await consent.context.close();
    const desktopConsent = await pageFor(browser, baseURL);
    await desktopConsent.page.setViewportSize({ width: 1440, height: 900 });
    await desktopConsent.page.screenshot({ path: `${screenshots}/desktop-join-consent.png`, fullPage: true });
    await desktopConsent.context.close();
    await joinTwo(browser, baseURL, { width: 390, height: 844 }, screenshots);
    await joinTwo(browser, baseURL, { width: 1440, height: 900 }, screenshots);
});
