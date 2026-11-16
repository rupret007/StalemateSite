const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const sizes = [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 1440, height: 900 }];

async function checkControls(page) {
    const controls = page.getByRole('group', { name: 'Call controls' });
    await expect(controls).toBeInViewport();
    for (const selector of ['[data-mic]', '[data-cam]', '[data-room-chat-open]']) {
        await expect(controls.locator(selector)).toBeInViewport({ ratio: 1 });
    }
    const geometry = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        bottom: document.querySelector('#room-call-controls').getBoundingClientRect().bottom
    }));
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    return geometry;
}

for (const viewport of sizes) {
    test(`private room stage, chat and controls at ${viewport.width}x${viewport.height}`, async ({ page, baseURL }, testInfo) => {
        await page.route(/youtube\.com|ytimg|googlevideo/, (route) => route.abort());
        await page.setViewportSize(viewport);
        await page.addInitScript(() => {
            window.roomCaptureRequests = 0;
            navigator.mediaDevices.getUserMedia = () => {
                window.roomCaptureRequests += 1;
                return Promise.reject(new DOMException('Fixture blocks capture', 'NotAllowedError'));
            };
        });
        const relay = hangoutRelayWsBase(baseURL, `room-workspace-${randomUUID()}`);
        await page.goto(`/r/45662413410ed051/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
        await page.locator('[data-name]').fill('RoomHost');
        await page.locator('[data-enter]').click();

        const start = page.getByRole('button', { name: 'Start video', exact: true });
        await expect(start).toBeVisible();
        await checkControls(page);
        await page.screenshot({ path: testInfo.outputPath('01-idle-stage.png') });

        await start.click();
        const prompt = page.getByRole('dialog', { name: 'Turn on your camera?' });
        await expect(prompt).toContainText('18+');
        expect(await page.evaluate(() => window.roomCaptureRequests)).toBe(0);
        await page.screenshot({ path: testInfo.outputPath('02-consent-before-capture.png') });
        await prompt.getByRole('button', { name: 'Not now' }).click();

        // Seed stand-in participants, then use the view control to render them without capture.
        await page.evaluate(() => {
            document.body.classList.add('faces-on');
            const { av, names } = window.__hangout;
            for (const [id, label] of [['speaker-fixture', 'Speaker'], ['guest-one', 'Guest one'], ['guest-two', 'Guest two']]) {
                names.set(id, label);
                av.peers.add(id);
            }
            document.querySelector('[data-view-toggle]').click();
        });
        const stage = page.locator('.tile--big');
        const strip = page.locator('[data-tiles] > .tile:not(.tile--big)').first();
        await expect(page.getByRole('button', { name: 'Grid view', exact: true })).toBeVisible();
        await expect(stage).toBeVisible();
        await expect(strip).toBeVisible();
        const stageBox = await stage.boundingBox();
        const tileBox = await strip.boundingBox();
        expect(stageBox.width).toBeGreaterThan(tileBox.width * 2);
        expect(tileBox.y).toBeGreaterThan(stageBox.y + stageBox.height);
        const call = await checkControls(page);
        if (viewport.width <= 820) expect(call.height).toBeLessThanOrEqual(call.viewportHeight + 2);
        await page.screenshot({ path: testInfo.outputPath('03-speaker-stage-and-filmstrip.png') });

        const chat = page.getByRole('region', { name: 'Chat', exact: true });
        const open = page.getByRole('button', { name: 'Chat', exact: true });
        await open.click();
        await expect(chat.getByRole('heading', { name: 'Chat' })).toBeFocused();
        const message = chat.getByRole('textbox', { name: 'Message' });
        await message.fill('An unsent message stays here');
        await page.screenshot({ path: testInfo.outputPath('04-chat-drawer.png') });

        await chat.getByRole('button', { name: 'Close chat' }).click();
        await expect(open).toBeFocused();
        await expect(chat).toBeHidden();
        await open.click();
        await expect(message).toHaveValue('An unsent message stays here');
        await expect(chat.getByRole('button', { name: 'Send' })).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => window.roomCaptureRequests)).toBe(0);
    });
}
