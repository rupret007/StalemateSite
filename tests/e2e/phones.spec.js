const { test, expect, tapHeight } = require('./fixtures');

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
        expect(tapHeight(await link.boundingBox())).toBeGreaterThanOrEqual(44);
    }
    expect(tapHeight(await page.locator('#home a.button--listen').boundingBox())).toBeGreaterThanOrEqual(44);
    for (const cta of await page.locator('#home a.button--hot').all()) expect(tapHeight(await cta.boundingBox())).toBeGreaterThanOrEqual(44);
    for (const href of [
        'https://www.instagram.com/stalemate.punk/',
        'https://www.youtube.com/@stalemate.punkband',
        'https://www.facebook.com/stalemate.band/'
    ]) {
        // Deliberate: the hero socials row is hidden on phones (it duplicates the header) so Manic makes the first screen.
        await expect(page.locator('#home a.social-link[href="' + href + '"]')).toBeHidden();
        await expect(page.locator('.site-header a.social-link[href="' + href + '"]')).toBeVisible();
        expect(tapHeight(await page.locator('.site-header a.social-link[href="' + href + '"]').boundingBox())).toBeGreaterThanOrEqual(44);
    }

    await expect(page.locator('.hero-show__tie')).toContainText('Hear it loud Oct 24 at Los Amigo’s, Plano');
    await expect(page.locator('body')).not.toContainText(/ticket/i);
});

test('phone first screen shows the countdown, Oct 24 show and Manic video before Games', async ({ page }) => {
    await page.goto('/');
    const vh = (await page.viewportSize()).height;
    const clock = await page.locator('[data-countdown-clock]').boundingBox();
    const video = await page.locator('.hero-video__player').boundingBox();
    const games = await page.locator('#games').boundingBox();
    const home = await page.locator('#home').boundingBox();
    const card = await page.locator('.hero-show-card').boundingBox();
    const cta = page.locator('[data-track="show-cta-hero"]');
    const ctaBox = await cta.boundingBox();
    const repeat = page.locator('[data-track="show-cta-under-video"]');
    await expect(repeat).toHaveText('See us Oct 24');
    await expect(repeat).toHaveAttribute('href', 'https://rockinoctober.com');
    await expect(cta).toHaveAttribute('href', 'https://rockinoctober.com');
    expect(clock.y + clock.height, 'countdown fully on the first screen').toBeLessThan(vh);
    expect(clock.y).toBeLessThan(video.y);
    expect(card.y).toBeLessThan(video.y);
    expect(ctaBox.y).toBeLessThan(video.y);
    expect(tapHeight(ctaBox)).toBeGreaterThanOrEqual(44);
    expect((await repeat.boundingBox()).y).toBeGreaterThan(video.y + video.height);
    expect(games.y).toBeGreaterThanOrEqual(home.y + home.height - 1);
    expect(games.y).toBeGreaterThan(clock.y + clock.height);
    expect(games.y).toBeGreaterThan(video.y + video.height);
});

test.describe('390x844 first screen', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('Manic video top is above the fold with the countdown and show card', async ({ page }) => {
        await page.goto('/');
        // Measure the settled layout: web fonts swapping in can shift the hero a few px.
        await page.evaluate(() => document.fonts.ready);
        const video = await page.locator('.hero-video__player').boundingBox();
        expect(video.y).toBeLessThan(844);
        expect(844 - video.y, 'a real slice of the video shows').toBeGreaterThanOrEqual(40);
        const clock = await page.locator('[data-countdown-clock]').boundingBox();
        expect(clock.y + clock.height).toBeLessThan(video.y);
        await expect(page.locator('.hero-show__cta a')).toBeVisible();
    });
});
