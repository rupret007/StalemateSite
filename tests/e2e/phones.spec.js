const { test, expect } = require('./fixtures');

test('phone homepage keeps the video-show hero usable without overflow', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);

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
    expect(await video.evaluate((node) => node.paused && node.currentTime === 0)).toBe(true);

    const frame = page.locator('.video-frame');
    const box = await frame.boundingBox();
    expect(box.width).toBeGreaterThan(240);
    expect(box.width).toBeLessThanOrEqual((await page.viewportSize()).width);
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.12);

    const clock = page.locator('[data-countdown-clock]');
    await expect(clock).toBeVisible();
    const clockBox = await clock.boundingBox();
    expect(clockBox.height).toBeLessThan(120);
    const firstTick = await clock.locator('li').first().boundingBox();
    const lastTick = await clock.locator('li').last().boundingBox();
    expect(Math.abs(firstTick.y - lastTick.y)).toBeLessThan(8);

    const titleBox = await page.locator('#band-title').boundingBox();
    const boardBox = await page.locator('.hero-board').boundingBox();
    const hotHeight = boardBox.height * 0.36;
    const overlapX = Math.max(0, Math.min(titleBox.x + titleBox.width, boardBox.x + boardBox.width) - Math.max(titleBox.x, boardBox.x));
    const overlapY = Math.max(0, Math.min(titleBox.y + titleBox.height, boardBox.y + hotHeight) - Math.max(titleBox.y, boardBox.y));
    expect(overlapX * overlapY, 'wordmark stays off the unfaded checker').toBe(0);

    const nav = page.getByRole('navigation', { name: 'Primary navigation', exact: true });
    for (const link of await nav.getByRole('link').all()) {
        expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    expect((await page.locator('#home a.button--listen').boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect((await page.locator('#home a.button--hot').boundingBox()).height).toBeGreaterThanOrEqual(44);
    for (const href of [
        'https://www.instagram.com/stalemate.punk/',
        'https://www.youtube.com/@stalemate.punkband',
        'https://www.facebook.com/stalemate.band/'
    ]) {
        const link = page.locator('#home a.social-link[href="' + href + '"]');
        await expect(link).toBeVisible();
        expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
        expect((await page.locator('.site-header a.social-link[href="' + href + '"]').boundingBox()).height).toBeGreaterThanOrEqual(44);
    }

    await expect(page.locator('.hero-show__tie')).toContainText('Hear it live Oct 24 at Los Amigo’s, Plano');
    await expect(page.locator('body')).not.toContainText(/ticket/i);
});
