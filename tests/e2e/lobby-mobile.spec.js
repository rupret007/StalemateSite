const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

for (const width of [375, 390]) {
    test(`chat fits ${width}px with readable text and reachable touch controls`, async ({ page, baseURL }, testInfo) => {
        await page.setViewportSize({ width, height: width === 375 ? 667 : 844 });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const relay = hangoutRelayWsBase(baseURL, `mobile-${randomUUID()}`);
        await page.goto(`/r/45662413410ed051/lobby/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
        await page.fill('[data-nick]', 'MobileTester');
        await expect(page.locator('[data-nick]')).toHaveCSS('font-size', '16px');
        await page.click('[data-enter]');
        await expect(page.locator('[data-buffer]')).toContainText('welcome to #stalemate');

        const fits = async () => {
            const sizes = await page.evaluate(() => ({
                page: document.documentElement.scrollWidth,
                body: document.body.scrollWidth,
                containers: ['.chat', '.topic', '.lobby-welcome', '.buffer', '.say'].map((s) => {
                    const e = document.querySelector(s);
                    return { client: e.clientWidth, scroll: e.scrollWidth };
                })
            }));
            expect(sizes.page).toBeLessThanOrEqual(width);
            expect(sizes.body).toBeLessThanOrEqual(width);
            for (const s of sizes.containers) expect(s.scroll).toBeLessThanOrEqual(s.client + 1);
            for (const selector of ['[data-text]', '[data-send]', '.phonetabs button']) {
                for (const control of await page.locator(selector).all()) {
                    await expect(control).toBeInViewport({ ratio: 1 });
                    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
                }
            }
        };
        await fits();
        await expect(page.locator('[data-buffer]')).toHaveCSS('font-size', '14px');
        await expect(page.locator('[data-text]')).toHaveCSS('font-size', '16px');
        for (const starter of await page.locator('[data-prompt]').all()) {
            await page.fill('[data-text]', '');
            await starter.scrollIntoViewIfNeeded();
            await expect(starter).toBeInViewport({ ratio: 1 });
            expect((await starter.boundingBox()).height).toBeGreaterThanOrEqual(44);
            await starter.click();
            await expect(page.locator('[data-text]')).toHaveValue(await starter.getAttribute('data-prompt'));
        }
        await page.fill('[data-text]', '');
        await page.locator('[data-text]').blur();
        await page.locator('.conversation-starters').evaluate((row) => { row.scrollLeft = 0; });
        await page.screenshot({ path: testInfo.outputPath(`chat-${width}.png`) });
        await testInfo.attach(`chat-${width}`, { path: testInfo.outputPath(`chat-${width}.png`), contentType: 'image/png' });

        // A long unbroken message must wrap in the real chat buffer.
        const message = 'abcdefghij'.repeat(24);
        await page.fill('[data-text]', message);
        await page.click('[data-send]');
        await expect(page.locator('[data-buffer]')).toContainText(message);
        await expect(page.locator('[data-text]')).toBeFocused();
        await fits();
        await page.locator('[data-quick-cmd="help"]').click();
        await fits();
        expect(await page.locator('.quick').evaluate((row) => row.scrollLeft)).toBeGreaterThan(0);

        // Safari's keyboard shrinks the visual viewport while its layout viewport stays tall.
        await page.fill('[data-text]', 'Draft survives the keyboard');
        await page.evaluate(() => {
            const nativeViewport = window.visualViewport;
            window.restoreTestViewport = () => Object.defineProperty(window, 'visualViewport', { configurable: true, value: nativeViewport });
            const viewport = new EventTarget();
            Object.assign(viewport, { height: 300, offsetTop: 25, scale: 1 });
            Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
            window.dispatchEvent(new Event('resize'));
        });
        await expect.poll(async () => {
            const box = await page.locator('[data-send]').boundingBox();
            return box.y + box.height;
        }).toBeLessThanOrEqual(325);
        await expect(page.locator('[data-text]')).toHaveValue('Draft survives the keyboard');
        await page.screenshot({ path: testInfo.outputPath(`keyboard-${width}.png`) });
        await page.evaluate(() => {
            window.dispatchEvent(new Event('pagehide'));
            Object.assign(window.visualViewport, { height: 280 });
            window.dispatchEvent(new Event('resize'));
        });
        await page.waitForTimeout(50);
        await expect.poll(() => page.evaluate(() => document.body.getBoundingClientRect().height)).toBe(300);
        await page.evaluate(() => {
            window.dispatchEvent(new Event('pageshow'));
            window.dispatchEvent(new Event('pageshow'));
        });
        await expect.poll(() => page.evaluate(() => document.body.getBoundingClientRect().height)).toBe(280);
        await expect(page.locator('[data-text]')).toHaveValue('Draft survives the keyboard');
        await expect(page.locator('[data-send]')).toBeInViewport({ ratio: 1 });
        await page.evaluate(() => {
            Object.assign(window.visualViewport, { height: 300 });
            window.dispatchEvent(new Event('resize'));
        });
        await expect.poll(() => page.evaluate(() => document.body.getBoundingClientRect().height)).toBe(300);
        await page.evaluate(() => {
            Object.assign(window.visualViewport, { height: 150, scale: 2 });
            window.dispatchEvent(new Event('resize'));
        });
        // Pinch zoom must not reflow the app into half its available height.
        await expect.poll(() => page.evaluate(() => document.body.getBoundingClientRect().height)).toBe(300);
        await page.evaluate(() => {
            Object.assign(window.visualViewport, { height: innerHeight, offsetTop: 0, scale: 1 });
            window.dispatchEvent(new Event('resize'));
        });
        await expect(page.locator('[data-lobby-welcome]')).toBeVisible();
        await fits();
        await page.evaluate(() => window.restoreTestViewport());
        await page.setViewportSize({ width: 667, height: 375 });
        await expect(page.locator('[data-send]')).toBeInViewport({ ratio: 1 });
        expect(errors).toEqual([]);
    });
}
