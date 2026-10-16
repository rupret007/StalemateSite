const { test, expect } = require('@playwright/test');

const paths = ['/', '/404.html', '/qr/', '/play/', '/play/TurdAnoid.html'];

function toggle(page) {
    return page.locator('[data-music-toggle]').first();
}

test.describe('site music toggle', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.removeItem('stalemate.music'); } catch (e) { /* */ }
        });
    });

    for (const path of paths) {
        test(`toggle is visible on ${path}`, async ({ page }) => {
            await page.goto(path);
            const control = toggle(page);
            await expect(control).toBeVisible();
            const box = await control.boundingBox();
            expect(box.height).toBeGreaterThanOrEqual(44);
            await expect(control).toHaveAttribute('aria-pressed', 'true');
            await expect(control).toHaveText('Music on');
        });
    }

    test('QR autoplay stays quiet when music is off', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('stalemate.music', 'off'));
        await page.goto('/qr/');
        const audio = page.locator('[data-qr-audio]');
        await page.waitForTimeout(400);
        expect(await audio.evaluate((node) => node.paused)).toBe(true);
    });
});

test('site music defaults to on and persists off across reload', async ({ page }) => {
    await page.goto('/');
    const control = toggle(page);
    await expect(control).toHaveAttribute('aria-pressed', 'true');
    await control.click();
    await expect(control).toHaveAttribute('aria-pressed', 'false');
    await expect(control).toHaveText('Music off');
    await expect(page.locator('html')).toHaveAttribute('data-stalemate-music-pref', 'off');
    await page.reload();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle(page)).toHaveText('Music off');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('stalemate.music'))).toBe('off');
});
