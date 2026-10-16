const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');

test('/play/ hosts Turdanoid same-origin, hidden and noindex', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/play/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
    await expect(page.locator('iframe')).toHaveCount(0);
    const strip = page.locator('nav.stalemate-strip');
    await expect(strip.locator('a.sm-home')).toHaveAttribute('href', '../');
    await expect(strip.locator('a.sm-listen')).toContainText('Listen to Manic');
    const card = page.locator('a.game-card[href="TurdAnoid.html"]');
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/play\/TurdAnoid\.html$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
    const canvas = page.locator('canvas#game');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box.width).toBeGreaterThan(200);
    const vp = page.viewportSize();
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
    await page.locator('#btnStart').click();
    await expect(page.locator('#btnStart')).toBeHidden();
    if (test.info().project.use.hasTouch) {
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.8);
    } else {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.8);
        await page.keyboard.press('Space');
    }
    await page.waitForTimeout(600);
    // Stalemate overlay: Manic starts after the first gesture and follows the game's mute button.
    await expect(page.locator('html')).toHaveAttribute('data-stalemate-music', 'playing');
    expect(await page.evaluate(() => window.StalemateMusic.src)).toMatch(/\/play\/stalemate\/manic\.m4a$/);
    expect(await page.evaluate(() => window.StalemateMusic.loop)).toBe(true);
    await page.locator('#btnSound').dispatchEvent('click');
    await expect(page.locator('html')).toHaveAttribute('data-stalemate-music', 'paused');
    await page.locator('#btnSound').dispatchEvent('click');
    await expect(page.locator('html')).toHaveAttribute('data-stalemate-music', 'playing');
    expect(errors).toEqual([]);
});

test('/play/ is not linked from the site and not packaged for Pages', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a[href*="play"]')).toHaveCount(0);
    const pkg = fs.readFileSync(path.join(ROOT, 'scripts/package-pages.cjs'), 'utf8');
    expect(pkg).not.toMatch(/play\//);
    for (const f of fs.readdirSync(path.join(ROOT, 'play')).filter((n) => n.endsWith('.html'))) {
        expect(fs.readFileSync(path.join(ROOT, 'play', f), 'utf8'), f).toContain('<meta name="robots" content="noindex,nofollow">');
    }
});
