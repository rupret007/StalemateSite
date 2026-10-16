const { test, expect } = require('./fixtures');

test('phone homepage keeps the video-show hero usable without overflow', async ({ page }) => {
    await page.goto('/');

    const overflow = await page.evaluate(() => {
        const width = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
        return width <= innerWidth + 1;
    });
    expect(overflow).toBe(true);

    const video = page.locator('.hero-video__player');
    await expect(video).toBeVisible();
    await expect(video).not.toHaveAttribute('autoplay');
    await expect(video).toHaveAttribute('playsinline', '');
    await expect(video).toHaveAttribute('preload', 'none');
    await expect(video.locator('source')).toHaveAttribute('src', 'assets/manic.mp4');

    const frame = page.locator('.video-frame');
    const box = await frame.boundingBox();
    expect(box.width).toBeGreaterThan(240);
    expect(box.width).toBeLessThanOrEqual((await page.viewportSize()).width);
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.12);

    const clock = page.locator('[data-countdown-clock]');
    await expect(clock).toBeVisible();
    const clockBox = await clock.boundingBox();
    expect(clockBox.height).toBeLessThan(120);

    const nav = page.getByRole('navigation', { name: 'Primary navigation', exact: true });
    for (const link of await nav.getByRole('link').all()) {
        expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    expect((await page.locator('#home a.button--listen').boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect((await page.locator('#home a.button--hot').boundingBox()).height).toBeGreaterThanOrEqual(44);

    await expect(page.locator('.hero-show__tie')).toContainText('Hear it live Oct 24 at Los Amigo’s, Plano');
    await expect(page.locator('body')).not.toContainText(/ticket/i);
});
